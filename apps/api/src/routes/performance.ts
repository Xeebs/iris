import { Hono } from 'hono';
import type postgres from 'postgres';

import { PerformanceProfiler } from '@iris/semantic-core/performance-profiler';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'performance' });
type SqlClient = ReturnType<typeof postgres>;

/**
 * Routes for performance profiler stats and Prometheus metrics.
 * Mounted under /api/v1/performance.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createPerformanceRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const profiler = new PerformanceProfiler(sql as ConstructorParameters<typeof PerformanceProfiler>[0]);

  /** GET /api/v1/performance/stats — per-operation latency percentiles */
  app.get('/stats', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const windowMinutes = Math.min(parseInt(c.req.query('window') ?? '60', 10), 1440);
    const result = await profiler.getStats(workspaceId, windowMinutes);
    if (result.isErr()) {
      log.error('Failed to get perf stats', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve stats' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /api/v1/performance/connectors — per-connector p95 breakdown */
  app.get('/connectors', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const windowMinutes = Math.min(parseInt(c.req.query('window') ?? '60', 10), 1440);
    const result = await profiler.getConnectorBreakdown(workspaceId, windowMinutes);
    if (result.isErr()) {
      log.error('Failed to get connector breakdown', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve connector stats' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /api/v1/performance/metrics — Prometheus text exposition */
  app.get('/metrics', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const result = await profiler.formatPrometheus(workspaceId);
    if (result.isErr()) {
      return c.text('# Error generating metrics\n', 500);
    }
    return c.text(result.value, 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  });

  /** POST /api/v1/performance/record — manually record a latency sample */
  app.post('/record', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    let body: { operation: string; durationMs: number; success?: boolean; connectorId?: string };
    try { body = await c.req.json() as typeof body; }
    catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400); }

    if (!body.operation || typeof body.durationMs !== 'number') {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'operation and durationMs are required' } }, 400);
    }

    await profiler.record(
      body.operation as Parameters<typeof profiler.record>[0],
      body.durationMs,
      body.success ?? true,
      workspaceId,
      body.connectorId,
    );

    return c.json({ data: { recorded: true } });
  });

  return app;
}
