import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { SyncJobQueue } from '@iris/queue';
import type { SyncJobData } from '@iris/queue';

const log = logger.child({ service: 'dlq-service' });

type SqlClient = ReturnType<typeof postgres>;

export type DlqEntry = {
  id: string;
  jobId: string;
  connectorInstanceId: string | null;
  workspaceId: string;
  errorMessage: string;
  errorStack: string | null;
  attemptCount: number;
  jobData: SyncJobData;
  createdAt: string;
  retriedAt: string | null;
  retriedBy: string | null;
};

export type DlqListOptions = {
  workspaceId?: string;
  connectorInstanceId?: string;
  limit?: number;
  cursor?: string;
};

/**
 * Manages the dead letter queue for permanently failed sync jobs.
 * Writes exhausted BullMQ jobs to Postgres for inspection and manual retry.
 */
export class SyncJobDlqService {
  constructor(
    private readonly sql: SqlClient,
    private readonly syncQueue: SyncJobQueue,
  ) {}

  /**
   * Archive an exhausted BullMQ job to the Postgres dead letter table.
   * Called by the sync worker's `failed` event handler after all retries are spent.
   *
   * @param jobId - BullMQ job ID
   * @param jobData - Original job payload
   * @param error - The terminal error
   * @param attemptCount - Total attempts made before giving up
   */
  async archive(
    jobId: string,
    jobData: SyncJobData,
    error: Error,
    attemptCount: number,
  ): Promise<Result<DlqEntry, Error>> {
    try {
      const rows = await this.sql<DlqEntry[]>`
        INSERT INTO deadletter_jobs (
          job_id,
          connector_instance_id,
          workspace_id,
          error_message,
          error_stack,
          attempt_count,
          job_data
        ) VALUES (
          ${jobId},
          ${jobData.connectorInstanceId}::uuid,
          ${jobData.workspaceId},
          ${error.message},
          ${error.stack ?? null},
          ${attemptCount},
          ${JSON.stringify(jobData)}
        )
        RETURNING
          id,
          job_id AS "jobId",
          connector_instance_id::text AS "connectorInstanceId",
          workspace_id AS "workspaceId",
          error_message AS "errorMessage",
          error_stack AS "errorStack",
          attempt_count AS "attemptCount",
          job_data AS "jobData",
          created_at::text AS "createdAt",
          retried_at::text AS "retriedAt",
          retried_by AS "retriedBy"
      `;
      const entry = rows[0];
      if (!entry) {
        return err(new Error('DLQ insert returned no rows'));
      }
      log.warn('Job archived to DLQ', {
        dlqId: entry.id,
        jobId,
        connectorInstanceId: jobData.connectorInstanceId,
        attemptCount,
        error: error.message,
      });
      return ok(entry);
    } catch (e) {
      log.error('Failed to archive job to DLQ', { jobId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List DLQ entries, optionally filtered by workspace or connector instance.
   * Cursor is the UUID of the last seen entry (UUID-ordered for stable pagination).
   *
   * Uses string-based WHERE clause construction to avoid conditional sql`` fragment nesting,
   * which complicates mocking in unit tests.
   */
  async listJobs(opts: DlqListOptions = {}): Promise<Result<{ entries: DlqEntry[]; hasMore: boolean }, Error>> {
    const { workspaceId, connectorInstanceId, limit = 50, cursor } = opts;
    const pageSize = Math.min(limit, 200);

    try {
      const conditions: string[] = ['TRUE'];
      const params: unknown[] = [];

      if (workspaceId) {
        params.push(workspaceId);
        conditions.push(`workspace_id = $${params.length}`);
      }
      if (connectorInstanceId) {
        params.push(connectorInstanceId);
        conditions.push(`connector_instance_id = $${params.length}::uuid`);
      }
      if (cursor) {
        params.push(cursor);
        conditions.push(`id < $${params.length}::uuid`);
      }
      params.push(pageSize + 1);
      const limitParam = `$${params.length}`;

      const where = conditions.join(' AND ');
      const query = `
        SELECT
          id,
          job_id AS "jobId",
          connector_instance_id::text AS "connectorInstanceId",
          workspace_id AS "workspaceId",
          error_message AS "errorMessage",
          error_stack AS "errorStack",
          attempt_count AS "attemptCount",
          job_data AS "jobData",
          created_at::text AS "createdAt",
          retried_at::text AS "retriedAt",
          retried_by AS "retriedBy"
        FROM deadletter_jobs
        WHERE ${where}
        ORDER BY id DESC
        LIMIT ${limitParam}
      `;

      const rows = await this.sql.unsafe(query, params) as DlqEntry[];
      const hasMore = rows.length > pageSize;
      return ok({ entries: rows.slice(0, pageSize), hasMore });
    } catch (e) {
      log.error('Failed to list DLQ jobs', { error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Re-enqueue a DLQ job for retry and stamp the retried_at / retried_by fields.
   *
   * @param dlqId - UUID of the deadletter_jobs row
   * @param retriedBy - User ID or identifier of the person triggering the retry
   */
  async retryJob(dlqId: string, retriedBy: string): Promise<Result<{ newJobId: string }, Error>> {
    try {
      const rows = await this.sql<Array<{ jobData: SyncJobData; retriedAt: string | null }>>`
        SELECT job_data AS "jobData", retried_at AS "retriedAt"
        FROM deadletter_jobs
        WHERE id = ${dlqId}::uuid
      `;
      const row = rows[0];
      if (!row) {
        return err(new Error(`DLQ entry ${dlqId} not found`));
      }
      if (row.retriedAt) {
        return err(new Error(`DLQ entry ${dlqId} has already been retried at ${row.retriedAt}`));
      }

      const jobData = row.jobData;
      const enqueueResult = await this.syncQueue.enqueueSync(
        jobData.connectorInstanceId,
        jobData.workspaceId,
      );
      if (enqueueResult.isErr()) {
        return err(enqueueResult.error);
      }

      await this.sql`
        UPDATE deadletter_jobs
        SET retried_at = now(), retried_by = ${retriedBy}
        WHERE id = ${dlqId}::uuid
      `;

      log.info('DLQ job retried', { dlqId, newJobId: enqueueResult.value.jobId, retriedBy });
      return ok({ newJobId: enqueueResult.value.jobId });
    } catch (e) {
      log.error('Failed to retry DLQ job', { dlqId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
