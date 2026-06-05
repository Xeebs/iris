import { Worker } from 'bullmq';
import type { Job } from 'bullmq';

import { logger } from '@iris/core/logger';
import { SYNC_QUEUE_NAME } from '@iris/queue';
import type { SyncJobData } from '@iris/queue';

const log = logger.child({ worker: 'sync-worker' });

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const parsed = new URL(redisUrl);
const connection = {
  host: parsed.hostname || 'localhost',
  port: parseInt(parsed.port || '6379', 10),
  ...(parsed.password ? { password: parsed.password } : {}),
};

const worker = new Worker<SyncJobData>(
  SYNC_QUEUE_NAME,
  async (job: Job<SyncJobData>) => {
    const { connectorInstanceId, workspaceId } = job.data;
    log.info('Processing sync job', { jobId: job.id, connectorInstanceId, workspaceId });

    // Connector sync execution is handled by the connector pipeline.
    // The worker is the entry point; actual sync logic will be wired
    // once the semantic indexer and connector registry are injected.
    log.info('Sync job completed', { jobId: job.id, connectorInstanceId });
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job: Job<SyncJobData>) => {
  log.info('Sync job completed', { jobId: job.id });
});

worker.on('failed', (job: Job<SyncJobData> | undefined, workerErr: Error) => {
  log.error('Sync job failed', { jobId: job?.id, error: workerErr });
});

worker.on('error', (workerErr: Error) => {
  log.error('Worker error', { error: workerErr });
});

log.info('Sync worker started', { queue: SYNC_QUEUE_NAME, concurrency: 5 });
