import { Queue } from 'bullmq';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';


const log = logger.child({ service: 'sync-job-queue' });

export const SYNC_QUEUE_NAME = 'connector-sync';

export type SyncJobData = {
  connectorInstanceId: string;
  workspaceId: string;
  triggeredAt: string;
};

export type SyncJobResult = {
  jobId: string;
  connectorInstanceId: string;
  status: 'queued';
};

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

/**
 * BullMQ-backed queue for async connector sync jobs.
 * Jobs are retried up to 3 times with exponential backoff on failure.
 */
export class SyncJobQueue {
  private queue: Queue<SyncJobData>;

  /**
   * @param redisUrl - Redis connection URL (e.g., redis://localhost:6379)
   */
  constructor(redisUrl: string) {
    this.queue = new Queue<SyncJobData>(SYNC_QUEUE_NAME, {
      connection: parseRedisUrl(redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    });
  }

  /**
   * @param connectorInstanceId - UUID of the connector instance to sync
   * @param workspaceId - Tenant workspace for isolation
   * @returns Job ID and initial queued status
   */
  async enqueueSync(
    connectorInstanceId: string,
    workspaceId: string,
  ): Promise<Result<SyncJobResult, Error>> {
    try {
      const job = await this.queue.add('sync', {
        connectorInstanceId,
        workspaceId,
        triggeredAt: new Date().toISOString(),
      });
      log.info('Sync job enqueued', { jobId: job.id, connectorInstanceId, workspaceId });
      return ok({ jobId: job.id!, connectorInstanceId, status: 'queued' });
    } catch (e) {
      log.error('Failed to enqueue sync job', { error: e, connectorInstanceId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param jobId - BullMQ job ID
   * @returns Current job state string, or null if the job no longer exists
   */
  async getJobStatus(jobId: string): Promise<Result<string | null, Error>> {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) return ok(null);
      const state = await job.getState();
      return ok(state);
    } catch (e) {
      log.error('Failed to get job status', { error: e, jobId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
