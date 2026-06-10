import { Worker } from 'bullmq';
import type { Job } from 'bullmq';

import { logger } from '@iris/core/logger';
import { SYNC_QUEUE_NAME, SyncJobQueue } from '@iris/queue';
import type { SyncJobData } from '@iris/queue';
import { ConnectorResilienceManager } from '@iris/queue/connector-resilience';
import { SyncJobDlqService } from '../services/dlq-service.js';
import { registry } from '@iris/connector-sdk';
import { indexEntities } from '@iris/semantic-core';
import { emitSyncEvent } from '@iris/semantic-core/sync-events';
import { ConnectorCDCManager } from '@iris/semantic-core/connector-cdc';
import type { VectorStore } from '@iris/semantic-core';
import { ConnectorService } from '../services/connector-service.js';
import { registerConnectors } from '../connector-registration.js';
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
  registerConnectors();
  const syncQueue = new SyncJobQueue(redisUrl);
  const dlqService = new SyncJobDlqService(sql, syncQueue);
  const connectorService = new ConnectorService(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resilienceManager = new ConnectorResilienceManager(sql as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cdcManager = new ConnectorCDCManager(sql as any);
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

        // 4–10. Run connect + sync + index under the resilience manager (retries, circuit breaker, bulkhead, timeout)
        const { indexResult, cdcStrategy, allEntities, changedEntities } = await resilienceManager.execute(
          instance.connectorId,
          async () => {
            const connectResult = await connector.connect(instance.config);
            if (connectResult.isErr()) {
              throw connectResult.error;
            }

            const manifest = registration.manifest;
            const supportedStrategies = manifest.cdcStrategies ?? ['snapshot_diff'];
            const cdcStrategy = cdcManager.selectStrategy(supportedStrategies);
            const cdcConfig = { strategy: cdcStrategy };

            const cdcState = (await cdcManager.getState(connectorInstanceId)).unwrapOr(null);
            const syncOptions: import('@iris/connector-sdk').SyncOptions = instance.lastSyncedAt
              ? {
                  lastSyncedAt: instance.lastSyncedAt,
                  ...(cdcState?.lastCursor ? { cursor: cdcState.lastCursor } : {}),
                }
              : {};

            const syncGenerator = connector.sync(syncOptions);
            const allEntities: import('@iris/connector-sdk').SemanticEntity[] = [];
            for await (const entity of syncGenerator) {
              allEntities.push(entity);
            }

            const deltasResult = await cdcManager.computeDeltas(connectorInstanceId, allEntities, cdcConfig);
            const deltas = deltasResult.unwrapOr(allEntities.map((e) => ({ entity: e, changeType: 'updated' as const })));
            const changedEntities = deltas
              .filter((d) => d.changeType !== 'unchanged')
              .map((d) => d.entity);

            async function* changedEntityGenerator() {
              for (const entity of changedEntities) yield entity;
            }
            const indexResult = await indexEntities(changedEntityGenerator(), vectorStore, { openAiApiKey, workspaceId });

            const runResult = cdcManager.buildRunResult(deltas);
            runResult.strategy = cdcStrategy;
            await cdcManager.updateState(connectorInstanceId, workspaceId, runResult, cdcConfig);

            return { indexResult, cdcStrategy, allEntities, changedEntities };
          },
        );

        log.info('Sync indexing complete', {
          connectorInstanceId,
          workspaceId,
          cdcStrategy,
          totalEntities: allEntities.length,
          changedEntities: changedEntities.length,
          created: indexResult.created,
          updated: indexResult.updated,
          deduplicated: indexResult.deduplicated,
          failed: indexResult.failed,
          durationMs: indexResult.durationMs,
        });

        // 11. Update lastSyncedAt and reset status to active
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
  const { createDefaultProvider } = await import('@iris/semantic-core/embedding-provider');

  const sql = postgres(pgUrl);
  const embeddingProvider = createDefaultProvider();
  const vectorStore = new PgvectorStore(pgUrl, embeddingProvider.getModelDimensions());
  await vectorStore.initialize();

  createSyncWorker(sql, vectorStore, openAiKey, redisUrl);
}
