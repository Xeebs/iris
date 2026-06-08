import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'admin-system' });

type SqlClient = ReturnType<typeof postgres>;

/**
 * @param sql - Postgres client
 * @returns Hono router for cross-system admin endpoints
 */
export function createAdminSystemRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /admin/system/performance/summary — aggregated latency + cache metrics */
  app.get('/performance/summary', async (c) => {
    const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 30);

    try {
      const [latency, cache, syncPerf] = await Promise.all([
        sql`
          SELECT
            AVG(duration_ms)::int              AS avg_latency_ms,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::int  AS p50_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms)::int AS p99_ms,
            COUNT(*)::int                      AS total_requests
          FROM request_traces
          WHERE started_at >= now() - (${days} || ' days')::interval
        `,
        sql`
          SELECT
            SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END)::int AS cache_hits,
            COUNT(*)::int                                      AS total_queries,
            ROUND(
              100.0 * SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2
            )::float AS cache_hit_rate_pct
          FROM token_events
          WHERE timestamp >= now() - (${days} || ' days')::interval
        `,
        sql`
          SELECT
            AVG(total_duration_ms)::int AS avg_sync_ms,
            COUNT(*)::int               AS total_syncs,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed_syncs
          FROM sync_performance
          WHERE started_at >= now() - (${days} || ' days')::interval
        `,
      ]);

      return c.json({
        data: {
          periodDays: days,
          latency: latency[0] ?? {},
          cache: cache[0] ?? {},
          sync: syncPerf[0] ?? {},
        },
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to fetch performance summary', { error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch performance summary' } }, 500);
    }
  });

  /** GET /admin/system/logs — paginated audit log search */
  app.get('/logs', async (c) => {
    const service = c.req.query('service');
    const level = c.req.query('level');
    const keyword = c.req.query('keyword');
    const correlationId = c.req.query('correlationId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const cursor = c.req.query('cursor');

    try {
      const rows = await sql`
        SELECT
          id,
          workspace_id,
          tool_name       AS service,
          query           AS message,
          duration_ms,
          cache_hit,
          token_estimate,
          timestamp
        FROM mcp_audit_log
        WHERE (${cursor ?? null}::text IS NULL OR id < ${cursor ?? null})
          AND (${service ?? null}::text IS NULL OR tool_name = ${service ?? null})
          AND (${keyword ?? null}::text IS NULL OR query ILIKE ${'%' + (keyword ?? '') + '%'})
          AND (${correlationId ?? null}::text IS NULL OR id = ${correlationId ?? null})
        ORDER BY timestamp DESC
        LIMIT ${limit + 1}
      `;

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (items[items.length - 1] as { id: string }).id : null;

      return c.json({ data: items, meta: { hasMore, nextCursor } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to search logs', { error: error.message, service, keyword });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to search logs' } }, 500);
    }
  });

  /** GET /admin/system/users — list all users across workspaces */
  app.get('/users', async (c) => {
    const keyword = c.req.query('keyword');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const cursor = c.req.query('cursor');

    try {
      const rows = await sql`
        SELECT
          wm.user_id,
          wm.role,
          wm.invited_at,
          wm.accepted_at,
          w.id   AS workspace_id,
          w.name AS workspace_name,
          MAX(al.timestamp) AS last_active_at
        FROM workspace_members wm
        JOIN workspaces w ON w.id = wm.workspace_id
        LEFT JOIN mcp_audit_log al ON al.workspace_id = wm.workspace_id
        WHERE (${cursor ?? null}::text IS NULL OR wm.user_id > ${cursor ?? null})
          AND (${keyword ?? null}::text IS NULL OR wm.user_id ILIKE ${'%' + (keyword ?? '') + '%'})
        GROUP BY wm.user_id, wm.role, wm.invited_at, wm.accepted_at, w.id, w.name
        ORDER BY wm.invited_at DESC
        LIMIT ${limit + 1}
      `;

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (items[items.length - 1] as { user_id: string }).user_id : null;

      return c.json({ data: items, meta: { hasMore, nextCursor } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to list users', { error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list users' } }, 500);
    }
  });

  const disableWorkspaceSchema = z.object({
    reason: z.string().min(1).optional(),
  });

  /** POST /admin/system/workspaces/:id/disable — suspend a workspace */
  app.post('/workspaces/:id/disable', async (c) => {
    const { id } = c.req.param();
    let body: unknown;
    try { body = await c.req.json(); } catch { body = {}; }
    const parsed = disableWorkspaceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    try {
      const result = await sql`
        UPDATE workspaces
        SET status = 'disabled', updated_at = now()
        WHERE id = ${id}
        RETURNING id, name, status
      `;
      if (result.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } }, 404);
      }
      log.info('Workspace disabled by admin', { workspaceId: id, reason: parsed.data.reason });
      return c.json({ data: result[0] });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to disable workspace', { workspaceId: id, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to disable workspace' } }, 500);
    }
  });

  return app;
}
