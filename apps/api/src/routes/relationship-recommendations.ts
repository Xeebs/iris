import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { RelationshipRecommendationService } from '@iris/semantic-core/relationship-recommender';

const SuggestQuerySchema = z.object({
  topK: z.coerce.number().int().min(1).max(50).optional().default(10),
});

const AutoLinkBodySchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  relationshipType: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const BulkSuggestBodySchema = z.object({
  entityIds: z.array(z.string().min(1)).min(1).max(20),
  topK: z.number().int().min(1).max(20).optional().default(5),
});

const FeedbackBodySchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
});

/**
 * Creates the relationship recommendations router.
 * @param sql - Postgres client instance
 * @returns Hono router mounted at /api/v1/relationship-recommendations
 */
export function makeRelationshipRecommendationsRouter(sql: ReturnType<typeof postgres>) {
  const router = new Hono();
  const svc = new RelationshipRecommendationService(sql);

  router.get('/entities/:entityId/suggestions', async (c) => {
    const { entityId } = c.req.param();
    const parsed = SuggestQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(c.req.url.split('?')[1] ?? '')));
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.suggestRelationships(entityId, parsed.data.topK);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  router.post('/auto-link', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = AutoLinkBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const { fromId, toId, relationshipType, confidence } = parsed.data;
    const result = await svc.autoLinkEntities(fromId, toId, relationshipType, confidence);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('threshold')) return c.json({ error: { code: 'CONFIDENCE_TOO_LOW', message: msg } }, 422);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  router.post('/feedback/accept', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = FeedbackBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.acceptRelationshipSuggestion(parsed.data.fromId, parsed.data.toId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { accepted: true } });
  });

  router.post('/feedback/deny', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = FeedbackBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.denyRelationshipSuggestion(parsed.data.fromId, parsed.data.toId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { denied: true } });
  });

  router.post('/bulk-suggest', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = BulkSuggestBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.bulkSuggestRelationships(parsed.data.entityIds, parsed.data.topK);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.get('/metrics', async (c) => {
    const result = await svc.getSuggestionMetrics();
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return router;
}
