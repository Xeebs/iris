import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'audit-log-service' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActorType = 'user' | 'api_key' | 'system';

export type AuditAction =
  | 'entity_read'
  | 'entity_write'
  | 'config_change'
  | 'permission_change'
  | 'connector_sync'
  | 'dsr_executed'
  | 'login'
  | 'logout';

export type AuditLog = {
  id: string;
  workspaceId: string;
  actorId: string | null;
  actorType: ActorType;
  action: AuditAction;
  resourceType: string | null;
  resourceId: string | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type LogActionInput = {
  workspaceId: string;
  actorId?: string;
  actorType: ActorType;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogFilters = {
  action?: AuditAction;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  cursor?: string;
  limit?: number;
};

export type PaginatedAuditLogs = {
  logs: AuditLog[];
  nextCursor: string | null;
  hasMore: boolean;
};

// ─── AuditLogService ──────────────────────────────────────────────────────────

/**
 * Tamper-evident audit log service for compliance and debugging.
 * All sensitive operations (config changes, DSR executions, permission grants) must be logged.
 */
export class AuditLogService {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Record a single audit log entry.
   *
   * @param input - Audit log fields
   */
  async logAction(input: LogActionInput): Promise<Result<AuditLog, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO audit_logs (
          workspace_id, actor_id, actor_type, action,
          resource_type, resource_id, changes,
          ip_address, user_agent, metadata
        ) VALUES (
          ${input.workspaceId},
          ${input.actorId ?? null},
          ${input.actorType},
          ${input.action},
          ${input.resourceType ?? null},
          ${input.resourceId ?? null},
          ${input.changes ? JSON.stringify(input.changes) : null},
          ${input.ipAddress ?? null},
          ${input.userAgent ?? null},
          ${JSON.stringify(input.metadata ?? {})}
        )
        RETURNING *
      ` as Record<string, unknown>[];

      return ok(this.rowToLog(rows[0]!));
    } catch (e) {
      log.error('Failed to write audit log', { action: input.action, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Query audit logs for a workspace with optional filters and cursor pagination.
   *
   * @param workspaceId - Tenant workspace
   * @param filters - Filter/pagination options
   */
  async queryLogs(
    workspaceId: string,
    filters: AuditLogFilters = {},
  ): Promise<Result<PaginatedAuditLogs, Error>> {
    const limit = Math.min(filters.limit ?? 50, 200);

    try {
      // Use a single query variant with null-safe filters to avoid nested sql template calls
      const rows = await this.sql`
        SELECT * FROM audit_logs
        WHERE workspace_id = ${workspaceId}
          AND (${filters.action ?? null} IS NULL OR action = ${filters.action ?? null})
          AND (${filters.actorId ?? null} IS NULL OR actor_id = ${filters.actorId ?? null})
          AND (${filters.resourceType ?? null} IS NULL OR resource_type = ${filters.resourceType ?? null})
          AND (${filters.resourceId ?? null} IS NULL OR resource_id = ${filters.resourceId ?? null})
          AND (${filters.startDate ?? null} IS NULL OR created_at >= ${filters.startDate ?? null})
          AND (${filters.endDate ?? null} IS NULL OR created_at <= ${filters.endDate ?? null})
          AND (${filters.cursor ?? null} IS NULL OR id < ${filters.cursor ?? null})
        ORDER BY created_at DESC
        LIMIT ${limit + 1}
      ` as Record<string, unknown>[];

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (pageRows[pageRows.length - 1]!['id'] as string) : null;

      return ok({
        logs: pageRows.map((r) => this.rowToLog(r)),
        nextCursor,
        hasMore,
      });
    } catch (e) {
      log.error('Failed to query audit logs', { workspaceId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Export audit logs as JSON or CSV.
   *
   * @param workspaceId - Tenant workspace
   * @param format - Export format
   * @param filters - Optional filters for the export scope
   */
  async exportLogs(
    workspaceId: string,
    format: 'json' | 'csv',
    filters: Omit<AuditLogFilters, 'cursor' | 'limit'> = {},
  ): Promise<Result<string, Error>> {
    const result = await this.queryLogs(workspaceId, { ...filters, limit: 200 });
    if (result.isErr()) return err(result.error);

    const { logs } = result.value;

    if (format === 'json') {
      return ok(JSON.stringify(logs, null, 2));
    }

    const header = 'id,workspace_id,actor_id,actor_type,action,resource_type,resource_id,ip_address,created_at';
    const rows = logs.map((l) =>
      [
        l.id,
        l.workspaceId,
        l.actorId ?? '',
        l.actorType,
        l.action,
        l.resourceType ?? '',
        l.resourceId ?? '',
        l.ipAddress ?? '',
        l.createdAt.toISOString(),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    return ok([header, ...rows].join('\n'));
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private rowToLog(row: Record<string, unknown>): AuditLog {
    return {
      id: row['id'] as string,
      workspaceId: row['workspace_id'] as string,
      actorId: row['actor_id'] as string | null,
      actorType: row['actor_type'] as ActorType,
      action: row['action'] as AuditAction,
      resourceType: row['resource_type'] as string | null,
      resourceId: row['resource_id'] as string | null,
      changes: row['changes'] as Record<string, unknown> | null,
      ipAddress: row['ip_address'] as string | null,
      userAgent: row['user_agent'] as string | null,
      metadata: (row['metadata'] as Record<string, unknown>) ?? {},
      createdAt: new Date(row['created_at'] as string),
    };
  }
}
