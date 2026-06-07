import { Worker } from 'bullmq';
import type { Job } from 'bullmq';

import { logger } from '@iris/core/logger';
import { SYNC_QUEUE_NAME, SyncJobQueue } from '@iris/queue';
import type { SyncJobData } from '@iris/queue';
import { SyncJobDlqService } from '../services/dlq-service.js';
import { registry } from '@iris/connector-sdk';
import { indexEntities } from '@iris/semantic-core';
import { emitSyncEvent } from '@iris/semantic-core/sync-events';
import type { VectorStore } from '@iris/semantic-core';
import { ConnectorService } from '../services/connector-service.js';
import type postgres from 'postgres';

const log = logger.child({ worker: 'sync-worker' });

type SqlClient = ReturnType<typeof postgres>;

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

/**
 * Create and start the BullMQ sync worker.
 * Wire up the connector registry, database, and vector store to execute full syncs.
 *
 * @param sql - Postgres client for connector instance persistence
 * @param vectorStore - Target vector store for indexed entities
 * @param openAiApiKey - API key for embedding generation during indexing
 * @param redisUrl - Redis connection URL (same instance as the job queue)
 */
export function createSyncWorker(
  sql: SqlClient,
  vectorStore: VectorStore,
  openAiApiKey: string,
  redisUrl: string,
): Worker<SyncJobData> {
  const syncQueue = new SyncJobQueue(redisUrl);
  const dlqService = new SyncJobDlqService(sql, syncQueue);
  const connectorService = new ConnectorService(sql);
  const connection = parseRedisUrl(redisUrl);

  const worker = new Worker<SyncJobData>(
    SYNC_QUEUE_NAME,
    async (job: Job<SyncJobData>) => {
      const { connectorInstanceId, workspaceId } = job.data;

      log.info('Sync job started', { jobId: job.id, connectorInstanceId, workspaceId });
      emitSyncEvent({ connectorInstanceId, workspaceId, eventType: 'sync_started', timestamp: new Date() });

      // 1. Fetch connector instance
      const instanceResult = await connectorService.getInstance(workspaceId, connectorInstanceId);
      if (instanceResult.isErr()) {
        throw new Error(`Failed to fetch connector instance: ${instanceResult.error.message}`);
      }
      const instance = instanceResult.value;
      if (!instance) {
        throw new Error(`Connector instance ${connectorInstanceId} not found`);
      }

      // 2. Mark as syncing
      await connectorService.updateStatus(connectorInstanceId, 'syncing');

      try {
        // 3. Instantiate connector via registry
        const registration = registry.get(instance.connectorId);
        const connector = registration.factory(instance.config);

        // 4. Connect
        const connectResult = await connector.connect(instance.config);
        if (connectResult.isErr()) {
          throw connectResult.error;
        }

        // 5. Stream entities from the connector sync generator
        const syncGenerator = connector.sync(
          instance.lastSyncedAt ? { lastSyncedAt: instance.lastSyncedAt } : {},
        );

        // 6. Index all yielded entities
        const indexResult = await indexEntities(syncGenerator, vectorStore, {
          openAiApiKey,
        });

        log.info('Sync indexing complete', {
          connectorInstanceId,
          workspaceId,
          created: indexResult.created,
          updated: indexResult.updated,
          deduplicated: indexResult.deduplicated,
          failed: indexResult.failed,
          durationMs: indexResult.durationMs,
        });

        // 7. Update lastSyncedAt and reset status to active
        await connectorService.updateStatus(connectorInstanceId, 'active', new Date());

        emitSyncEvent({
          connectorInstanceId,
          workspaceId,
          eventType: 'sync_completed',
          timestamp: new Date(),
          metadata: {
            created: indexResult.created,
            updated: indexResult.updated,
            durationMs: indexResult.durationMs,
          },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error('Sync job failed', { jobId: job.id, connectorInstanceId, error: e });

        await connectorService.updateStatus(connectorInstanceId, 'error');
        emitSyncEvent({
          connectorInstanceId,
          workspaceId,
          eventType: 'sync_failed',
          timestamp: new Date(),
          metadata: { error: message },
        });

        throw e; // Let BullMQ handle retries
      }
    },
    { connection, concurrency: 5 },
  );

  worker.on('completed', (job: Job<SyncJobData>) => {
    log.info('Sync job committed', { jobId: job.id });
  });

  worker.on('failed', (job: Job<SyncJobData> | undefined, workerErr: Error) => {
    if (!job) return;
    const maxAttempts = (job.opts.attempts ?? 1);
    const isExhausted = job.attemptsMade >= maxAttempts;
    if (isExhausted) {
      log.error('Sync job exhausted all retries — archiving to DLQ', {
        jobId: job.id,
        attempts: job.attemptsMade,
        error: workerErr.message,
      });
      dlqService.archive(job.id!, job.data, workerErr, job.attemptsMade).catch((archiveErr) => {
        log.error('Failed to archive exhausted job to DLQ', { jobId: job.id, error: archiveErr });
      });
    } else {
      log.warn('Sync job failed, will retry', {
        jobId: job.id,
        attempt: job.attemptsMade,
        maxAttempts,
        error: workerErr.message,
      });
    }
  });

  worker.on('error', (workerErr: Error) => {
    log.error('Worker error', { error: workerErr });
  });

  log.info('Sync worker started', { queue: SYNC_QUEUE_NAME, concurrency: 5 });

  return worker;
}

// Bootstrap when run directly (not imported)
if (process.env['SYNC_WORKER_STANDALONE'] === 'true') {
  const pgUrl = process.env['DATABASE_URL']!;
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const openAiKey = process.env['OPENAI_API_KEY'] ?? '';

  const postgres = (await import('postgres')).default;
  const { PgvectorStore } = await import('@iris/semantic-core');

  const sql = postgres(pgUrl);
  const vectorStore = new PgvectorStore(pgUrl);
  await vectorStore.initialize();

  createSyncWorker(sql, vectorStore, openAiKey, redisUrl);
}
