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

  /**
   * Retrieve queue depth and job counts for monitoring.
   * @returns Active, waiting, completed, and failed job counts
   */
  async getQueueStats(): Promise<Result<SyncQueueStats, Error>> {
    try {
      const [active, waiting, completed, failed, delayed] = await Promise.all([
        this.queue.getActiveCount(),
        this.queue.getWaitingCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);
      return ok({ active, waiting, completed, failed, delayed });
    } catch (e) {
      log.error('Failed to get queue stats', { error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get recent active and waiting jobs for the monitoring view.
   * @param limit - Max jobs to return (default 20)
   */
  async getActiveJobs(limit = 20): Promise<Result<ActiveJobSummary[], Error>> {
    try {
      const [active, waiting] = await Promise.all([
        this.queue.getActive(0, limit),
        this.queue.getWaiting(0, limit),
      ]);
      type AnyJob = { id?: string; data: SyncJobData; progress: unknown; timestamp?: number };
      const toSummary = (j: AnyJob, state: 'active' | 'waiting'): ActiveJobSummary => ({
        jobId: j.id ?? '',
        connectorInstanceId: j.data.connectorInstanceId,
        workspaceId: j.data.workspaceId,
        triggeredAt: j.data.triggeredAt,
        state,
        progress: typeof j.progress === 'number' ? j.progress : 0,
        elapsedMs: j.timestamp ? Date.now() - j.timestamp : 0,
      });
      return ok([
        ...active.slice(0, limit).map((j) => toSummary(j as AnyJob, 'active')),
        ...waiting.slice(0, Math.max(0, limit - active.length)).map((j) => toSummary(j as AnyJob, 'waiting')),
      ]);
    } catch (e) {
      log.error('Failed to get active jobs', { error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export type SyncQueueStats = {
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
};

export type ActiveJobSummary = {
  jobId: string;
  connectorInstanceId: string;
  workspaceId: string;
  triggeredAt: string;
  state: 'active' | 'waiting';
  progress: number;
  elapsedMs: number;
};

// ─── Performance Tracking ─────────────────────────────────────────────────────

export interface SyncPerformanceMetrics {
  apiTimeMs?: number;
  indexingTimeMs?: number;
  embeddingTimeMs?: number;
  apiCalls?: number;
  entitiesSynced?: number;
  avgEntitySizeBytes?: number;
  peakMemoryMb?: number;
  errorCount?: number;
}

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ count?: number }[]>;

/**
 * Records per-sync performance metrics to the sync_performance table.
 * Inject a postgres tagged-template client to persist metrics.
 */
export class SyncPerformanceTracker {
  private startTime: number = 0;

  constructor(private readonly sql: SqlFn) {}

  /**
   * @param jobId - BullMQ job ID
   * @param connectorInstanceId - Connector being synced
   * @param workspaceId - Tenant workspace
   * @returns Row ID for the tracking record
   */
  async start(
    jobId: string,
    connectorInstanceId: string,
    workspaceId: string,
  ): Promise<string> {
    this.startTime = Date.now();
    const rows = await this.sql`
      INSERT INTO sync_performance (job_id, connector_instance_id, workspace_id, status)
      VALUES (${jobId}, ${connectorInstanceId}, ${workspaceId}, 'started')
      RETURNING id
    `;
    const row = rows[0] as { id: string } | undefined;
    return row?.id ?? '';
  }

  /**
   * @param rowId - ID returned from start()
   * @param metrics - Collected performance metrics
   */
  async complete(rowId: string, metrics: SyncPerformanceMetrics): Promise<void> {
    const totalMs = Date.now() - this.startTime;
    await this.sql`
      UPDATE sync_performance
      SET total_duration_ms = ${totalMs},
          api_time_ms = ${metrics.apiTimeMs ?? null},
          indexing_time_ms = ${metrics.indexingTimeMs ?? null},
          embedding_time_ms = ${metrics.embeddingTimeMs ?? null},
          api_calls = ${metrics.apiCalls ?? 0},
          entities_synced = ${metrics.entitiesSynced ?? 0},
          avg_entity_size_bytes = ${metrics.avgEntitySizeBytes ?? null},
          peak_memory_mb = ${metrics.peakMemoryMb ?? null},
          error_count = ${metrics.errorCount ?? 0},
          status = 'completed',
          completed_at = now()
      WHERE id = ${rowId}
    `;
    log.info('Sync performance recorded', { rowId, totalMs, ...metrics });
  }

  /**
   * @param rowId - ID returned from start()
   * @param errorCount - Number of errors that occurred
   */
  async fail(rowId: string, errorCount = 1): Promise<void> {
    const totalMs = Date.now() - this.startTime;
    await this.sql`
      UPDATE sync_performance
      SET total_duration_ms = ${totalMs},
          error_count = ${errorCount},
          status = 'failed',
          completed_at = now()
      WHERE id = ${rowId}
    `;
  }
}
