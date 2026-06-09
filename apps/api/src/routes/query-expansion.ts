import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { QueryExpansionEngine } from '@iris/semantic-core/query-expansion-engine';

const FEEDBACK_MARKS = ['stale', 'incomplete', 'irrelevant', 'useful'] as const;

const ExpandBodySchema = z.object({
  query: z.string().min(1),
  stage: z.number().int().min(1).optional().default(1),
  feedback: z.array(z.object({
    entityId: z.string().min(1),
    mark: z.enum(FEEDBACK_MARKS),
  })).optional().default([]),
});

const FeedbackBodySchema = z.object({
  feedback: z.array(z.object({
    entityId: z.string().min(1),
    mark: z.enum(FEEDBACK_MARKS),
  })).min(1),
});

const RefineBodySchema = z.object({
  results: z.array(z.object({
    entityId: z.string().min(1),
    entityType: z.string(),
    label: z.string(),
    score: z.number(),
    stage: z.number(),
  })).min(1),
  feedback: z.array(z.object({
    entityId: z.string().min(1),
    mark: z.enum(FEEDBACK_MARKS),
  })).min(1),
});

/**
 * Creates the query expansion router.
 * @param sql - Postgres client instance
 * @returns Hono router
 */
export function makeQueryExpansionRouter(sql: ReturnType<typeof postgres>) {
  const router = new Hono();
  const svc = new QueryExpansionEngine(sql);

  router.post('/expand', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ExpandBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const { query, stage, feedback } = parsed.data;
    const result = await svc.expandQuery(query, stage, feedback.length > 0 ? feedback : null);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('empty')) return c.json({ error: { code: 'VALIDATION_ERROR', message: msg } }, 400);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  router.post('/refine', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = RefineBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.refineContextByFeedback(parsed.data.results, parsed.data.feedback);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.post('/sessions/:sessionId/feedback', async (c) => {
    const { sessionId } = c.req.param();
    const body = await c.req.json().catch(() => null);
    const parsed = FeedbackBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.recordFeedback(sessionId, parsed.data.feedback);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { recorded: true } });
  });

  router.get('/sessions/:sessionId', async (c) => {
    const { sessionId } = c.req.param();
    const result = await svc.getSession(sessionId);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  return router;
}
