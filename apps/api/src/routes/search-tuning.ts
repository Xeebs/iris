import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { RelevanceTuner } from '@iris/semantic-core/relevance-tuner';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'search-tuning' });

type SqlClient = ReturnType<typeof postgres>;

const feedbackSchema = z.object({
  query: z.string().min(1).max(500),
  clickedEntityId: z.string().min(1),
  rank: z.number().int().min(1).max(100),
  feedbackScore: z.number().min(0).max(1).optional().default(1.0),
  dwellTimeMs: z.number().int().min(0).optional(),
});

const weightUpdateSchema = z.object({
  factorName: z.enum([
    'bm25_weight',
    'embedding_weight',
    'type_boost_contact',
    'type_boost_deal',
    'type_boost_company',
    'recency_boost',
    'relationship_distance_penalty',
  ]),
  tunedValue: z.number().min(-1).max(10),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for search relevance tuning endpoints
 */
export function createSearchTuningRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const tuner = new RelevanceTuner(sql as unknown as ReturnType<typeof postgres>);

  /** POST /search-tuning/feedback — record a click-through signal */
  app.post('/feedback', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    let body: unknown;
    try { body = await c.req.json(); } catch { body = {}; }
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    try {
      await tuner.recordFeedback({ workspaceId, ...parsed.data } as Parameters<typeof tuner.recordFeedback>[0]);
      return c.json({ data: { recorded: true } }, 201);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to record feedback', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to record feedback' } }, 500);
    }
  });

  /** GET /search-tuning/weights — get current scoring weights for workspace */
  app.get('/weights', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    try {
      const weights = await tuner.loadWeights(workspaceId);
      return c.json({ data: weights });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to load weights', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load weights' } }, 500);
    }
  });

  /** PUT /search-tuning/weights — update a single scoring factor weight */
  app.put('/weights', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    let body: unknown;
    try { body = await c.req.json(); } catch { body = {}; }
    const parsed = weightUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    try {
      await tuner.updateWeight({ workspaceId, ...parsed.data });
      const updated = await tuner.loadWeights(workspaceId);
      return c.json({ data: updated });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (error.message.includes('must be') || error.message.includes('non-negative') || error.message.includes('degenerate')) {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, 422);
      }
      log.error('Failed to update weight', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update weight' } }, 500);
    }
  });

  /** DELETE /search-tuning/weights — reset all weights to defaults */
  app.delete('/weights', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    try {
      await tuner.resetWeights(workspaceId);
      return c.json({ data: { reset: true } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to reset weights', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to reset weights' } }, 500);
    }
  });

  /** GET /search-tuning/analytics — aggregated click-through data */
  app.get('/analytics', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const windowDays = Math.min(parseInt(c.req.query('days') ?? '30', 10), 90);

    try {
      const data = await tuner.analyzeFeedback(workspaceId, windowDays);
      return c.json({ data });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to fetch analytics', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch analytics' } }, 500);
    }
  });

  return app;
}
