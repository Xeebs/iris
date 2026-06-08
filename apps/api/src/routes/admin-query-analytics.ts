import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { QueryPerformanceAnalyzer } from '@iris/semantic-core/query-performance-analyzer';
import { SearchQualityEvaluator } from '@iris/semantic-core/search-quality-evaluator';

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

  // ─── Search experiments ────────────────────────────────────────────────────

  const createExperimentSchema = z.object({
    name: z.string().min(1),
    controlStrategy: z.enum(['vector', 'bm25', 'hybrid']),
    treatmentStrategy: z.enum(['vector', 'bm25', 'hybrid']),
    testSetId: z.string().uuid().optional(),
    trafficPct: z.number().int().min(1).max(100).optional(),
  });

  /** POST /admin/analytics/search-experiments — create a new A/B experiment */
  app.post('/search-experiments', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';
    let body: unknown;
    try { body = await c.req.json(); } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400);
    }
    const parsed = createExperimentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const evaluator = new SearchQualityEvaluator(sql);
    const result = await evaluator.createExperiment(
      workspaceId,
      parsed.data.name,
      parsed.data.controlStrategy,
      parsed.data.treatmentStrategy,
      parsed.data.testSetId,
      parsed.data.trafficPct,
    );
    if (result.isErr()) {
      log.error('Failed to create search experiment', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create experiment' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** GET /admin/analytics/search-experiments — list experiments */
  app.get('/search-experiments', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';
    const status = c.req.query('status') as Parameters<SearchQualityEvaluator['listExperiments']>[1];

    const evaluator = new SearchQualityEvaluator(sql);
    const result = await evaluator.listExperiments(workspaceId, status);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list experiments' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /admin/analytics/search-experiments/:id/results — aggregated metrics */
  app.get('/search-experiments/:id/results', async (c) => {
    const { id } = c.req.param();
    const evaluator = new SearchQualityEvaluator(sql);
    const result = await evaluator.getResults(id);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get results' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** PUT /admin/analytics/search-experiments/:id/promote — promote winner to production */
  app.put('/search-experiments/:id/promote', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';
    const { id } = c.req.param();

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400);
    }
    const parsed = z.object({ winner: z.enum(['vector', 'bm25', 'hybrid']) }).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'winner is required (vector|bm25|hybrid)' } }, 400);
    }

    const evaluator = new SearchQualityEvaluator(sql);
    const result = await evaluator.promoteExperiment(workspaceId, id, parsed.data.winner);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found') || msg.includes('not in running')) {
        return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to promote experiment' } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
