import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { BatchContextRecommender } from '@iris/semantic-core/batch-recommender';

const RecommendBodySchema = z.object({
  entityIds: z.array(z.string().min(1)).min(1).max(50),
  topK: z.number().int().min(1).max(50).optional().default(10),
});

const AnalyzeBodySchema = z.object({
  entityIds: z.array(z.string().min(1)).min(1).max(50),
});

const GroupScoreBodySchema = z.object({
  entityIds: z.array(z.string().min(1)).min(1).max(50),
  metric: z.string().min(1),
});

/**
 * Creates the batch recommendations router.
 * @param sql - Postgres client instance
 * @returns Hono router
 */
export function makeBatchRecommendationsRouter(sql: ReturnType<typeof postgres>) {
  const router = new Hono();
  const svc = new BatchContextRecommender(sql);

  router.post('/recommend-contexts', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = RecommendBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.recommendContextForEntities(parsed.data.entityIds, parsed.data.topK);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  router.post('/analyze', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = AnalyzeBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.analyzeEntityGroup(parsed.data.entityIds);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.post('/group-actions', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = AnalyzeBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.suggestGroupActions(parsed.data.entityIds);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.post('/group-score', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = GroupScoreBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.computeGroupScore(parsed.data.entityIds, parsed.data.metric);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.get('/results/:sessionId', async (c) => {
    const { sessionId } = c.req.param();
    const result = await svc.getSessionResult(sessionId);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  return router;
}
