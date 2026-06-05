import postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'audit' });

export interface AuditEvent {
  workspaceId: string;
  toolName: string;
  query: string;
  tokenEstimate: number;
  cacheHit: boolean;
  durationMs: number;
}

export interface AuditRecord extends AuditEvent {
  id: string;
  timestamp: Date;
}

export interface AuditLogOptions {
  limit?: number;
  cursor?: string;
  toolName?: string;
}

export interface AuditLogPage {
  records: AuditRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Audit logger backed by Postgres.
 * Logs every MCP tool invocation for analytics, billing, and debugging.
 */
export class AuditLogger {
  private readonly sql: ReturnType<typeof postgres>;

  /**
   * @param connectionString - Postgres connection string
   */
  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { ssl: false });
  }

  /** Create the audit table if it does not exist. Call once at startup. */
  async initialize(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS iris_audit_log (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id  TEXT NOT NULL,
        tool_name     TEXT NOT NULL,
        query         TEXT NOT NULL DEFAULT '',
        token_estimate INTEGER NOT NULL DEFAULT 0,
        cache_hit     BOOLEAN NOT NULL DEFAULT FALSE,
        duration_ms   INTEGER NOT NULL,
        timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS iris_audit_workspace_ts_idx
      ON iris_audit_log (workspace_id, timestamp DESC)
    `;
    log.info('AuditLogger initialized');
  }

  /**
   * Persist one MCP tool invocation to the audit table.
   *
   * @param event - Audit event to record
   */
  async logAuditEvent(event: AuditEvent): Promise<void> {
    try {
      await this.sql`
        INSERT INTO iris_audit_log
          (workspace_id, tool_name, query, token_estimate, cache_hit, duration_ms)
        VALUES
          (${event.workspaceId}, ${event.toolName}, ${event.query},
           ${event.tokenEstimate}, ${event.cacheHit}, ${event.durationMs})
      `;
    } catch (err) {
      log.error('Failed to write audit event', { error: err, event });
    }
  }

  /**
   * Retrieve a paginated audit log for a workspace.
   * Uses cursor-based pagination (cursor = last record's timestamp ISO string + ":" + id).
   *
   * @param workspaceId - Workspace to query
   * @param options     - Pagination and filter options
   * @returns A page of audit records with a next cursor
   */
  async getAuditLog(workspaceId: string, options: AuditLogOptions = {}): Promise<AuditLogPage> {
    const limit = Math.min(options.limit ?? 50, 200);
    const fetchLimit = limit + 1;

    type Row = {
      id: string;
      workspace_id: string;
      tool_name: string;
      query: string;
      token_estimate: number;
      cache_hit: boolean;
      duration_ms: number;
      timestamp: Date;
    };

    let rows: Row[];

    if (options.cursor) {
      const [cursorTs, cursorId] = options.cursor.split(':');
      rows = await this.sql<Row[]>`
        SELECT id, workspace_id, tool_name, query, token_estimate, cache_hit, duration_ms, timestamp
        FROM iris_audit_log
        WHERE workspace_id = ${workspaceId}
          ${options.toolName ? this.sql`AND tool_name = ${options.toolName}` : this.sql``}
          AND (timestamp, id) < (${cursorTs ?? ''}::timestamptz, ${cursorId ?? ''})
        ORDER BY timestamp DESC, id DESC
        LIMIT ${fetchLimit}
      `;
    } else {
      rows = await this.sql<Row[]>`
        SELECT id, workspace_id, tool_name, query, token_estimate, cache_hit, duration_ms, timestamp
        FROM iris_audit_log
        WHERE workspace_id = ${workspaceId}
          ${options.toolName ? this.sql`AND tool_name = ${options.toolName}` : this.sql``}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${fetchLimit}
      `;
    }

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = page[page.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? `${lastRow.timestamp.toISOString()}:${lastRow.id}`
        : null;

    const records: AuditRecord[] = page.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      toolName: r.tool_name,
      query: r.query,
      tokenEstimate: r.token_estimate,
      cacheHit: r.cache_hit,
      durationMs: r.duration_ms,
      timestamp: r.timestamp,
    }));

    return { records, nextCursor, hasMore };
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}
