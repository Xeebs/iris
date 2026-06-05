import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'audit' });

const auditQuerySchema = z.object({
  workspaceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
  toolName: z.string().optional(),
});

type SqlClient = ReturnType<typeof postgres>;

type AuditRow = {
  id: string;
  workspace_id: string;
  tool_name: string;
  query: string;
  token_estimate: number;
  cache_hit: boolean;
  duration_ms: number;
  timestamp: Date;
};

/**
 * @param sql - Postgres client
 */
export function createAuditRoutes(sql: SqlClient): Hono {
  const routes = new Hono();

  /** GET /api/v1/audit?workspaceId=&limit=&cursor=&toolName= */
  routes.get('/', async (c) => {
    const parsed = auditQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query params',
            details: parsed.error.errors,
          },
        },
        400,
      );
    }
    const { workspaceId, limit, cursor, toolName } = parsed.data;
    const fetchLimit = limit + 1;

    let rows: AuditRow[];
    if (cursor) {
      const [cursorTs, cursorId] = cursor.split(':');
      rows = await sql<AuditRow[]>`
        SELECT id, workspace_id, tool_name, query, token_estimate, cache_hit, duration_ms, timestamp
        FROM iris_audit_log
        WHERE workspace_id = ${workspaceId}
          ${toolName ? sql`AND tool_name = ${toolName}` : sql``}
          AND (timestamp, id) < (${cursorTs ?? ''}::timestamptz, ${cursorId ?? ''})
        ORDER BY timestamp DESC, id DESC
        LIMIT ${fetchLimit}
      `;
    } else {
      rows = await sql<AuditRow[]>`
        SELECT id, workspace_id, tool_name, query, token_estimate, cache_hit, duration_ms, timestamp
        FROM iris_audit_log
        WHERE workspace_id = ${workspaceId}
          ${toolName ? sql`AND tool_name = ${toolName}` : sql``}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${fetchLimit}
      `;
    }

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = page[page.length - 1];
    const nextCursor = hasMore && lastRow ? `${lastRow.timestamp.toISOString()}:${lastRow.id}` : null;

    const records = page.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      toolName: r.tool_name,
      query: r.query,
      tokenEstimate: r.token_estimate,
      cacheHit: r.cache_hit,
      durationMs: r.duration_ms,
      timestamp: r.timestamp,
    }));

    log.info('Audit log fetched', { workspaceId, count: records.length });
    return c.json({
      data: records,
      meta: { hasMore, nextCursor },
    });
  });

  return routes;
}
