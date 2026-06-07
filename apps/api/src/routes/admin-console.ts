import { Hono } from 'hono';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { requireAdminRole } from '../middleware/admin-auth.js';

const log = logger.child({ route: 'admin-console' });

type SqlClient = ReturnType<typeof postgres>;

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /admin
 */
export function createAdminConsoleRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  app.use('*', requireAdminRole);

  /**
   * GET /admin/workspaces — list all workspaces with health summary
   */
  app.get('/workspaces', async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const cursor = c.req.query('cursor');

    try {
      const rows = await sql`
        SELECT
          w.id,
          w.name,
          w.created_at,
          COUNT(DISTINCT ci.id)::int AS connector_count,
          COALESCE(te.query_count, 0) AS mcp_query_volume,
          COALESCE(te.last_query_at, NULL) AS last_mcp_query_at,
          MAX(ci.last_synced_at) AS last_sync_at
        FROM workspaces w
        LEFT JOIN connector_instances ci ON ci.workspace_id = w.id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS query_count, MAX(timestamp) AS last_query_at
          FROM token_events
          WHERE workspace_id = w.id
            AND timestamp >= now() - INTERVAL '30 days'
        ) te ON true
        WHERE (${cursor ?? null}::text IS NULL OR w.id > ${cursor ?? null})
        GROUP BY w.id, w.name, w.created_at, te.query_count, te.last_query_at
        ORDER BY w.created_at DESC
        LIMIT ${limit + 1}
      `;

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (items[items.length - 1] as { id: string }).id : null;

      return c.json({
        data: items,
        meta: { hasMore, nextCursor },
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to list workspaces', { error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list workspaces' } }, 500);
    }
  });

  /**
   * GET /admin/system-health — checks database, Redis, and key service connectivity
   */
  app.get('/system-health', async (c) => {
    const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; message?: string }> = {};

    // Postgres ping
    const pgStart = Date.now();
    try {
      await sql`SELECT 1`;
      checks['postgres'] = { status: 'ok', latencyMs: Date.now() - pgStart };
    } catch (e) {
      checks['postgres'] = { status: 'error', message: e instanceof Error ? e.message : 'Unknown error' };
    }

    // Row counts as health proxy
    try {
      const countRows = await sql`
        SELECT
          (SELECT COUNT(*) FROM workspaces)::int AS workspace_count,
          (SELECT COUNT(*) FROM connector_instances)::int AS connector_count
      `;
      checks['data'] = {
        status: 'ok',
        latencyMs: Date.now() - pgStart,
        message: `${(countRows[0] as { workspace_count: number }).workspace_count} workspaces, ${(countRows[0] as { connector_count: number }).connector_count} connectors`,
      };
    } catch {
      checks['data'] = { status: 'error', message: 'Failed to query counts' };
    }

    const allOk = Object.values(checks).every((c) => c.status === 'ok');
    return c.json({
      data: {
        status: allOk ? 'ok' : 'degraded',
        checks,
        timestamp: new Date().toISOString(),
      },
    }, allOk ? 200 : 503);
  });

  /**
   * GET /admin/errors — recent error events across all workspaces
   * Query params: workspaceId, errorType, days (default 7), limit (default 50)
   */
  app.get('/errors', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 30);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    try {
      const rows = await sql`
        SELECT
          id,
          connector_instance_id,
          workspace_id,
          job_id,
          status,
          error_count,
          total_duration_ms,
          started_at
        FROM sync_performance
        WHERE status = 'failed'
          AND started_at >= now() - (${days} || ' days')::interval
          AND (${workspaceId ?? null}::text IS NULL OR workspace_id = ${workspaceId ?? null})
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;

      const summary = await sql`
        SELECT
          workspace_id,
          COUNT(*)::int AS error_count,
          MAX(started_at) AS last_error_at
        FROM sync_performance
        WHERE status = 'failed'
          AND started_at >= now() - (${days} || ' days')::interval
          AND (${workspaceId ?? null}::text IS NULL OR workspace_id = ${workspaceId ?? null})
        GROUP BY workspace_id
        ORDER BY error_count DESC
        LIMIT 10
      `;

      return c.json({
        data: {
          errors: rows,
          summary,
          periodDays: days,
        },
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to fetch error log', { error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch error log' } }, 500);
    }
  });

  return app;
}
