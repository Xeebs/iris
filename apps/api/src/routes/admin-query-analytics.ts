import { Hono } from 'hono';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { QueryPerformanceAnalyzer } from '@iris/semantic-core/query-performance-analyzer';

const log = logger.child({ route: 'admin-query-analytics' });

type SqlClient = ReturnType<typeof postgres>;

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /admin/analytics
 */
export function createAdminQueryAnalyticsRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /admin/analytics/queries/slow — top 10 slow queries by p95 latency */
  app.get('/queries/slow', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';
    const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 50);
    const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 30);

    const analyzer = new QueryPerformanceAnalyzer(sql as ConstructorParameters<typeof QueryPerformanceAnalyzer>[0]);
    const result = await analyzer.analyzeSlowQueries(workspaceId, limit, days);
    if (result.isErr()) {
      log.error('Failed to analyze slow queries', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch slow queries' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /admin/analytics/queries/patterns — entity access heatmap */
  app.get('/queries/patterns', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 30);

    const analyzer = new QueryPerformanceAnalyzer(sql as ConstructorParameters<typeof QueryPerformanceAnalyzer>[0]);
    const result = await analyzer.analyzeQueryPatterns(workspaceId, limit, days);
    if (result.isErr()) {
      log.error('Failed to analyze query patterns', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch query patterns' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /admin/analytics/index-recommendations — vector index optimization suggestions */
  app.get('/index-recommendations', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';

    const analyzer = new QueryPerformanceAnalyzer(sql as ConstructorParameters<typeof QueryPerformanceAnalyzer>[0]);
    const result = await analyzer.optimizeVectorIndex(workspaceId);
    if (result.isErr()) {
      log.error('Failed to generate index recommendations', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to generate recommendations' } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
