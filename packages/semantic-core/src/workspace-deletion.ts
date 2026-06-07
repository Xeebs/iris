import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'workspace-deletion' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeletionStatus = 'none' | 'pending' | 'cancelled' | 'backup_in_progress' | 'completed';

export interface DeletionRequest {
  id: string;
  workspaceId: string;
  requestedBy: string;
  reason?: string;
  status: DeletionStatus;
  scheduledAt: Date;
  backupExportId?: string;
  cancelledAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface DeletionPolicy {
  workspaceId: string;
  retentionDays: number;
  backupBeforeDeletion: boolean;
  legalHold: boolean;
}

export interface RequestDeletionOptions {
  reason?: string;
  retentionDays?: number;
}

const DEFAULT_RETENTION_DAYS = 30;

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Manages workspace deletion lifecycle including soft deletion, backup, and permanent removal.
 */
export class WorkspaceDeletionService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Initiates a soft deletion request for a workspace. The workspace will be
   * permanently deleted after the grace period unless cancelled.
   *
   * @param workspaceId - The workspace to schedule for deletion
   * @param requestedBy - User ID initiating the request
   * @param options - Optional reason and retention period override
   * @returns The created deletion request
   */
  async requestDeletion(
    workspaceId: string,
    requestedBy: string,
    options: RequestDeletionOptions = {},
  ): Promise<Result<DeletionRequest, Error>> {
    const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;

    try {
      const existing = await this.sql`
        SELECT id, status FROM workspace_deletion_requests
        WHERE workspace_id = ${workspaceId}
          AND status IN ('pending', 'backup_in_progress')
        LIMIT 1
      `;

      if (existing.length > 0) {
        return err(new Error('A deletion request is already pending for this workspace'));
      }

      const policy = await this.getPolicy(workspaceId);
      if (policy.isOk() && policy.value.legalHold) {
        return err(new Error('Workspace is under legal hold and cannot be deleted'));
      }

      const scheduledAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

      const rows = await this.sql`
        INSERT INTO workspace_deletion_requests
          (workspace_id, requested_by, reason, status, scheduled_at)
        VALUES
          (${workspaceId}, ${requestedBy}, ${options.reason ?? null}, 'pending', ${scheduledAt.toISOString()})
        ON CONFLICT (workspace_id) DO UPDATE
          SET status = 'pending',
              requested_by = EXCLUDED.requested_by,
              reason = EXCLUDED.reason,
              scheduled_at = EXCLUDED.scheduled_at,
              cancelled_at = NULL,
              completed_at = NULL,
              updated_at = now()
        RETURNING id, workspace_id, requested_by, reason, status, scheduled_at, created_at
      `;

      await this.sql`
        INSERT INTO workspace_deletion_audit (workspace_id, event, performed_by, details)
        VALUES (${workspaceId}, 'deletion_requested', ${requestedBy},
                ${JSON.stringify({ reason: options.reason, scheduledAt, retentionDays }) as unknown as string}::jsonb)
      `;

      log.info('Workspace deletion requested', { workspaceId, requestedBy, scheduledAt });
      return ok(mapRequestRow(rows[0]));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to request workspace deletion', { workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Cancels a pending deletion request within the grace period.
   *
   * @param workspaceId - Workspace to cancel deletion for
   * @param cancelledBy - User ID performing the cancellation
   * @returns Updated deletion request or error if no cancellable request found
   */
  async cancelDeletion(
    workspaceId: string,
    cancelledBy: string,
  ): Promise<Result<DeletionRequest, Error>> {
    try {
      const rows = await this.sql`
        UPDATE workspace_deletion_requests
        SET status = 'cancelled',
            cancelled_at = now(),
            updated_at = now()
        WHERE workspace_id = ${workspaceId}
          AND status IN ('pending', 'backup_in_progress')
          AND scheduled_at > now()
        RETURNING id, workspace_id, requested_by, reason, status, scheduled_at,
                  cancelled_at, completed_at, created_at
      `;

      if (rows.length === 0) {
        return err(new Error('No cancellable deletion request found — request may have already completed or expired'));
      }

      await this.sql`
        INSERT INTO workspace_deletion_audit (workspace_id, event, performed_by, details)
        VALUES (${workspaceId}, 'deletion_cancelled', ${cancelledBy}, '{}')
      `;

      log.info('Workspace deletion cancelled', { workspaceId, cancelledBy });
      return ok(mapRequestRow(rows[0]));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to cancel workspace deletion', { workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Permanently deletes all workspace data. Should only be called after the
   * grace period has elapsed and (optionally) after backup completion.
   *
   * @param workspaceId - Workspace to permanently delete
   * @param performedBy - Admin user ID authorizing the deletion
   * @returns Count of deleted rows per table or error
   */
  async permanentlyDelete(
    workspaceId: string,
    performedBy: string,
  ): Promise<Result<Record<string, number>, Error>> {
    try {
      const request = await this.sql`
        SELECT id, status, scheduled_at FROM workspace_deletion_requests
        WHERE workspace_id = ${workspaceId}
          AND status IN ('pending', 'backup_in_progress')
        LIMIT 1
      `;

      if (request.length === 0) {
        return err(new Error('No active deletion request found for workspace'));
      }

      const scheduledAt = new Date((request[0] as { scheduled_at: Date }).scheduled_at);
      if (scheduledAt > new Date()) {
        return err(new Error(`Grace period has not elapsed — deletion scheduled for ${scheduledAt.toISOString()}`));
      }

      const counts: Record<string, number> = {};

      await this.sql.begin(async (tx) => {
        const tables = [
          'workspace_members',
          'team_invitations',
          'glossary_terms',
          'metrics',
          'connector_instances',
          'mcp_api_keys',
          'token_events',
          'audit_log',
          'workspace_nlp_configs',
          'workflow_templates',
          'alert_rules',
          'alert_channels',
          'export_jobs',
          'deadletter_jobs',
          'canonical_entity_links',
          'connector_health',
        ];

        for (const table of tables) {
          try {
            const result = await tx`
              DELETE FROM ${tx(table)}
              WHERE workspace_id = ${workspaceId}
            `;
            counts[table] = result.count ?? 0;
          } catch {
            counts[table] = 0;
          }
        }

        await tx`
          UPDATE workspace_deletion_requests
          SET status = 'completed', completed_at = now(), updated_at = now()
          WHERE workspace_id = ${workspaceId}
        `;

        await tx`
          INSERT INTO workspace_deletion_audit (workspace_id, event, performed_by, details)
          VALUES (${workspaceId}, 'permanent_deletion_completed', ${performedBy},
                  ${JSON.stringify({ tableCounts: counts }) as unknown as string}::jsonb)
        `;
      });

      log.info('Workspace permanently deleted', { workspaceId, performedBy, counts });
      return ok(counts);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to permanently delete workspace', { workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Returns the current deletion status for a workspace.
   *
   * @param workspaceId - Workspace to query
   * @returns Current deletion request or null if no active request
   */
  async getDeletionStatus(
    workspaceId: string,
  ): Promise<Result<DeletionRequest | null, Error>> {
    try {
      const rows = await this.sql`
        SELECT id, workspace_id, requested_by, reason, status, scheduled_at,
               backup_export_id, cancelled_at, completed_at, created_at
        FROM workspace_deletion_requests
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (rows.length === 0) {
        return ok(null);
      }

      return ok(mapRequestRow(rows[0]));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to get deletion status', { workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Returns the deletion policy for a workspace, creating a default one if missing.
   *
   * @param workspaceId - Workspace to query
   * @returns Deletion policy
   */
  async getPolicy(workspaceId: string): Promise<Result<DeletionPolicy, Error>> {
    try {
      const rows = await this.sql`
        SELECT workspace_id, retention_days, backup_before_deletion, legal_hold
        FROM workspace_deletion_policies
        WHERE workspace_id = ${workspaceId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        return ok({
          workspaceId,
          retentionDays: DEFAULT_RETENTION_DAYS,
          backupBeforeDeletion: true,
          legalHold: false,
        });
      }

      const row = rows[0] as {
        workspace_id: string;
        retention_days: number;
        backup_before_deletion: boolean;
        legal_hold: boolean;
      };
      return ok({
        workspaceId: row.workspace_id,
        retentionDays: row.retention_days,
        backupBeforeDeletion: row.backup_before_deletion,
        legalHold: row.legal_hold,
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return err(error);
    }
  }

  /**
   * Updates the deletion policy for a workspace.
   *
   * @param workspaceId - Workspace to update
   * @param policy - Policy fields to apply
   * @returns Updated policy
   */
  async updatePolicy(
    workspaceId: string,
    policy: Partial<Omit<DeletionPolicy, 'workspaceId'>>,
  ): Promise<Result<DeletionPolicy, Error>> {
    try {
      const retentionDays = policy.retentionDays ?? DEFAULT_RETENTION_DAYS;
      const backupBeforeDeletion = policy.backupBeforeDeletion ?? true;
      const legalHold = policy.legalHold ?? false;

      await this.sql`
        INSERT INTO workspace_deletion_policies
          (workspace_id, retention_days, backup_before_deletion, legal_hold)
        VALUES
          (${workspaceId}, ${retentionDays}, ${backupBeforeDeletion}, ${legalHold})
        ON CONFLICT (workspace_id) DO UPDATE
          SET retention_days = EXCLUDED.retention_days,
              backup_before_deletion = EXCLUDED.backup_before_deletion,
              legal_hold = EXCLUDED.legal_hold,
              updated_at = now()
      `;

      return ok({ workspaceId, retentionDays, backupBeforeDeletion, legalHold });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return err(error);
    }
  }
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

interface RequestRow {
  id: string;
  workspace_id: string;
  requested_by: string;
  reason?: string | null;
  status: string;
  scheduled_at: Date;
  backup_export_id?: string | null;
  cancelled_at?: Date | null;
  completed_at?: Date | null;
  created_at: Date;
}

function mapRequestRow(r: unknown): DeletionRequest {
  const row = r as RequestRow;
  const req: DeletionRequest = {
    id: row.id,
    workspaceId: row.workspace_id,
    requestedBy: row.requested_by,
    status: row.status as DeletionStatus,
    scheduledAt: new Date(row.scheduled_at),
    createdAt: new Date(row.created_at),
  };
  if (row.reason != null) req.reason = row.reason;
  if (row.backup_export_id != null) req.backupExportId = row.backup_export_id;
  if (row.cancelled_at != null) req.cancelledAt = new Date(row.cancelled_at);
  if (row.completed_at != null) req.completedAt = new Date(row.completed_at);
  return req;
}
