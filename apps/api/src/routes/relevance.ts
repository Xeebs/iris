import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { RelevanceTuner, DEFAULT_WEIGHTS } from '@iris/semantic-core/relevance-tuner';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'relevance-routes' });

const FACTOR_NAMES = [
  'bm25_weight',
  'embedding_weight',
  'type_boost_contact',
  'type_boost_deal',
  'type_boost_company',
  'recency_boost',
  'relationship_distance_penalty',
] as const;

const UpdateWeightBody = z.object({
  factorName: z.enum(FACTOR_NAMES),
  value: z.number().finite(),
});

const FeedbackBody = z.object({
  query: z.string().min(1),
  clickedEntityId: z.string().min(1),
  rank: z.number().int().min(0),
  feedbackScore: z.number().min(-1).max(1).default(1),
  dwellTimeMs: z.number().int().positive().optional(),
});

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createRelevanceRoutes(sql: Sql): Hono {
  const router = new Hono();
  const tuner = new RelevanceTuner(sql as never);

  router.get('/weights', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    try {
      const weights = await tuner.loadWeights(workspaceId);
      return c.json({
        data: {
          weights,
          defaults: DEFAULT_WEIGHTS,
          factorNames: FACTOR_NAMES,
        },
      });
    } catch (e) {
      log.error('Failed to load weights', { error: String(e) });
      return c.json({ error: { code: 'FETCH_FAILED', message: String(e) } }, 500);
    }
  });

  router.put('/weights', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const parsed = UpdateWeightBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.format() } }, 400);
    }

    const { factorName, value } = parsed.data;

    try {
      await tuner.updateWeight({ workspaceId, factorName, tunedValue: value });
      const updated = await tuner.loadWeights(workspaceId);
      return c.json({ data: { weights: updated } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isValidation = msg.includes('must be') || msg.includes('≥');
      return c.json({ error: { code: isValidation ? 'VALIDATION_ERROR' : 'UPDATE_FAILED', message: msg } }, isValidation ? 422 : 500);
    }
  });

  router.delete('/weights', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    try {
      await tuner.resetWeights(workspaceId);
      return c.json({ data: { weights: DEFAULT_WEIGHTS, reset: true } });
    } catch (e) {
      return c.json({ error: { code: 'RESET_FAILED', message: String(e) } }, 500);
    }
  });

  router.post('/feedback', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const parsed = FeedbackBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid feedback body', details: parsed.error.format() } }, 400);
    }

    try {
      await tuner.recordFeedback({ workspaceId, ...parsed.data } as Parameters<typeof tuner.recordFeedback>[0]);
      return c.json({ data: { recorded: true } });
    } catch (e) {
      log.error('Failed to record feedback', { error: String(e) });
      return c.json({ error: { code: 'RECORD_FAILED', message: String(e) } }, 500);
    }
  });

  router.get('/metrics', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const windowDays = Math.min(Number(c.req.query('days') ?? 30), 90);

    try {
      const feedback = await tuner.analyzeFeedback(workspaceId, windowDays);
      return c.json({ data: { feedback, windowDays } });
    } catch (e) {
      log.error('Failed to fetch relevance metrics', { error: String(e) });
      return c.json({ error: { code: 'FETCH_FAILED', message: String(e) } }, 500);
    }
  });

  return router;
}
