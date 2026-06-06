import { Queue } from 'bullmq';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';
import { SYNC_QUEUE_NAME } from './sync-job-queue.js';
import type { SyncJobData } from './sync-job-queue.js';

const log = logger.child({ service: 'sync-schedule' });

/** Minimal SQL client interface — compatible with the postgres tagged template API. */
type SqlClient = <T = Record<string, unknown>[]>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T>;

export type SyncFrequency = 'real-time' | 'hourly' | 'daily' | 'weekly' | 'manual' | 'custom';

export type ScheduleConfig = {
  frequency: SyncFrequency;
  cronExpression?: string;
  startTime?: string;
};

export type ConnectorSchedule = {
  connectorInstanceId: string;
  frequency: SyncFrequency;
  cronExpression: string | null;
  startTime: string | null;
};

const FREQUENCY_TO_CRON: Partial<Record<SyncFrequency, string>> = {
  hourly: '0 * * * *',
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
};

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

function scheduleJobId(connectorInstanceId: string): string {
  return `schedule:${connectorInstanceId}`;
}

/**
 * Manages recurring sync schedules using BullMQ repeatable jobs.
 * Schedule metadata is persisted in Postgres; repeatable jobs are stored in Redis.
 */
export class SyncScheduleService {
  private readonly queue: Queue<SyncJobData>;

  /**
   * @param sql - Postgres client for reading/writing schedule config
   * @param redisUrl - Redis URL for BullMQ queue
   */
  constructor(
    private readonly sql: SqlClient,
    redisUrl: string,
  ) {
    this.queue = new Queue<SyncJobData>(SYNC_QUEUE_NAME, {
      connection: parseRedisUrl(redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }

  /**
   * Create or replace a connector's repeatable sync schedule.
   * Also persists the schedule config to the connector_instances table.
   *
   * @param connectorInstanceId - UUID of the connector instance
   * @param workspaceId - Tenant workspace for job data
   * @param config - Schedule frequency and optional cron expression
   */
  async upsertSchedule(
    connectorInstanceId: string,
    workspaceId: string,
    config: ScheduleConfig,
  ): Promise<Result<void, Error>> {
    // Remove any existing repeatable job first
    const removeResult = await this.removeSchedule(connectorInstanceId);
    if (removeResult.isErr()) {
      log.warn('Failed to remove existing schedule, proceeding with upsert', {
        connectorInstanceId,
        error: removeResult.error,
      });
    }

    // Persist schedule config to DB
    try {
      await this.sql`
        UPDATE connector_instances
        SET sync_frequency       = ${config.frequency},
            sync_schedule_cron   = ${config.cronExpression ?? null},
            sync_start_time      = ${config.startTime ?? null},
            updated_at           = NOW()
        WHERE id = ${connectorInstanceId}
      `;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to persist schedule to DB', { connectorInstanceId, error });
      return err(error);
    }

    // For manual or real-time, no repeatable job needed
    if (config.frequency === 'manual' || config.frequency === 'real-time') {
      log.info('Schedule updated (no repeatable job needed)', { connectorInstanceId, frequency: config.frequency });
      return ok(undefined);
    }

    // Determine cron pattern
    const cron = config.frequency === 'custom'
      ? config.cronExpression
      : FREQUENCY_TO_CRON[config.frequency];

    if (!cron) {
      return err(new Error(`Cannot determine cron pattern for frequency "${config.frequency}"`));
    }

    try {
      await this.queue.add(
        'sync',
        { connectorInstanceId, workspaceId, triggeredAt: new Date().toISOString() },
        {
          repeat: { pattern: cron, tz: 'UTC' },
          jobId: scheduleJobId(connectorInstanceId),
        },
      );
      log.info('Repeatable sync job created', { connectorInstanceId, frequency: config.frequency, cron });
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to create repeatable BullMQ job', { connectorInstanceId, cron, error });
      return err(error);
    }
  }

  /**
   * Remove the repeatable BullMQ job for a connector instance.
   * Does not modify the DB record — call upsertSchedule with 'manual' to fully clear.
   *
   * @param connectorInstanceId - UUID of the connector instance
   */
  async removeSchedule(connectorInstanceId: string): Promise<Result<void, Error>> {
    try {
      const repeatableJobs = await this.queue.getRepeatableJobs();
      const targetId = scheduleJobId(connectorInstanceId);
      const match = repeatableJobs.find((j) => j.id === targetId);
      if (match) {
        await this.queue.removeRepeatableByKey(match.key);
        log.info('Repeatable sync job removed', { connectorInstanceId });
      }
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to remove repeatable BullMQ job', { connectorInstanceId, error });
      return err(error);
    }
  }

  /**
   * Read the current schedule configuration for a connector instance from the DB.
   *
   * @param workspaceId - Tenant workspace
   * @param connectorInstanceId - UUID of the connector instance
   */
  async getSchedule(
    workspaceId: string,
    connectorInstanceId: string,
  ): Promise<Result<ConnectorSchedule | null, Error>> {
    try {
      const rows = await this.sql<
        Array<{
          sync_frequency: string;
          sync_schedule_cron: string | null;
          sync_start_time: string | null;
        }>
      >`
        SELECT sync_frequency, sync_schedule_cron, sync_start_time
        FROM connector_instances
        WHERE id = ${connectorInstanceId} AND workspace_id = ${workspaceId}
        LIMIT 1
      `;

      if (rows.length === 0) return ok(null);

      const row = rows[0]!;
      return ok({
        connectorInstanceId,
        frequency: row.sync_frequency as SyncFrequency,
        cronExpression: row.sync_schedule_cron,
        startTime: row.sync_start_time,
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to read schedule from DB', { connectorInstanceId, error });
      return err(error);
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
