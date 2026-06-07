import { Hono } from 'hono';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'admin-performance' });

type SqlClient = ReturnType<typeof postgres>;

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /admin/performance
 */
export function createAdminPerformanceRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /**
   * GET /admin/performance/connectors/:id
   * Returns historical sync performance metrics for a connector instance.
   * Query params: days (default 30), limit (default 50)
   */
  app.get('/connectors/:id', async (c) => {
    const connectorInstanceId = c.req.param('id');
    const workspaceId: string = c.get('workspaceId') as string;
    const days = Math.min(parseInt(c.req.query('days') ?? '30', 10), 90);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    try {
      const rows = await sql`
        SELECT
          id,
          job_id,
          connector_instance_id,
          total_duration_ms,
          api_time_ms,
          indexing_time_ms,
          embedding_time_ms,
          api_calls,
          entities_synced,
          avg_entity_size_bytes,
          peak_memory_mb,
          error_count,
          status,
          started_at,
          completed_at
        FROM sync_performance
        WHERE connector_instance_id = ${connectorInstanceId}
          AND workspace_id = ${workspaceId}
          AND started_at >= now() - (${days} || ' days')::interval
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;

      const aggregates = await sql`
        SELECT
          COUNT(*)::int AS total_syncs,
          AVG(total_duration_ms)::int AS avg_duration_ms,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_duration_ms)::int AS p50_duration_ms,
          PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY total_duration_ms)::int AS p90_duration_ms,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_duration_ms)::int AS p99_duration_ms,
          SUM(entities_synced)::int AS total_entities_synced,
          AVG(entities_synced)::real AS avg_entities_per_sync,
          SUM(error_count)::int AS total_errors,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_syncs,
          AVG(peak_memory_mb)::real AS avg_peak_memory_mb
        FROM sync_performance
        WHERE connector_instance_id = ${connectorInstanceId}
          AND workspace_id = ${workspaceId}
          AND started_at >= now() - (${days} || ' days')::interval
      `;

      return c.json({
        data: {
          connectorInstanceId,
          periodDays: days,
          syncs: rows,
          aggregates: aggregates[0] ?? null,
        },
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to fetch connector performance', { connectorInstanceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch performance data' } }, 500);
    }
  });

  /**
   * GET /admin/performance/summary
   * Returns aggregated performance across all connectors for the workspace.
   */
  app.get('/summary', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const days = Math.min(parseInt(c.req.query('days') ?? '30', 10), 90);

    try {
      const rows = await sql`
        SELECT
          connector_instance_id,
          COUNT(*)::int AS sync_count,
          AVG(total_duration_ms)::int AS avg_duration_ms,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_duration_ms)::int AS p50_ms,
          PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY total_duration_ms)::int AS p90_ms,
          SUM(entities_synced)::int AS total_entities,
          SUM(error_count)::int AS total_errors,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
          MAX(started_at) AS last_sync_at
        FROM sync_performance
        WHERE workspace_id = ${workspaceId}
          AND started_at >= now() - (${days} || ' days')::interval
        GROUP BY connector_instance_id
        ORDER BY avg_duration_ms DESC NULLS LAST
      `;

      return c.json({ data: { periodDays: days, connectors: rows } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to fetch performance summary', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch performance summary' } }, 500);
    }
  });

  return app;
}
