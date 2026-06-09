import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { AutoTuningOptimizer } from '@iris/semantic-core/auto-tuning-optimizer';

type SqlClient = ReturnType<typeof postgres>;

const applyTestSchema = z.object({
  recommendationId: z.string().uuid(),
});

const feedbackSchema = z.object({
  helpful: z.boolean(),
});

const concludeSchema = z.object({
  controlMetric: z.number(),
  treatmentMetric: z.number(),
});

/**
 * Routes for AI-assisted index auto-tuning recommendations.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createAutoTuningRoutes(sql: SqlClient) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new AutoTuningOptimizer(sql as unknown as any);

  const getWorkspaceId = (c: Context) =>
    (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');

  /** GET /optimization/recommendations — list pending recommendations */
  app.get('/recommendations', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await svc.listRecommendations(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /optimization/recommendations/generate — run analysis and generate new recommendations */
  app.post('/recommendations/generate', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await svc.generateRecommendations(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  /** POST /optimization/recommendations/:id/apply-test — activate A/B test */
  app.post('/recommendations/:id/apply-test', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const parsed = applyTestSchema.safeParse({ recommendationId: c.req.param('id') });
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid recommendation ID' } }, 400);
    const result = await svc.activateAbTest(workspaceId, parsed.data.recommendationId);
    if (result.isErr()) return c.json({ error: { code: 'UNPROCESSABLE', message: result.error.message } }, 422);
    return c.json({ data: result.value }, 201);
  });

  /** POST /optimization/recommendations/:id/feedback — record helpful/not-helpful */
  app.post('/recommendations/:id/feedback', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400); }
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const result = await svc.recordFeedback(workspaceId, c.req.param('id'), parsed.data.helpful);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { success: true } });
  });

  /** POST /optimization/ab-tests/:testId/conclude — conclude an A/B test */
  app.post('/ab-tests/:testId/conclude', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400); }
    const parsed = concludeSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const result = await svc.concludeAbTest(c.req.param('testId'), parsed.data.controlMetric, parsed.data.treatmentMetric);
    if (result.isErr()) return c.json({ error: { code: 'UNPROCESSABLE', message: result.error.message } }, 422);
    return c.json({ data: result.value });
  });

  /** GET /optimization/query-patterns — returns query pattern analysis */
  app.get('/query-patterns', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const days = parseInt(c.req.query('days') ?? '30', 10);
    const result = await svc.analyzeQueryPatterns(workspaceId, days);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return app;
}
