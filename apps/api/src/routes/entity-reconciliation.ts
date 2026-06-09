import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { EntityReconciler } from '@iris/semantic-core/entity-reconciler';

const FindMatchesSchema = z.object({
  topK: z.coerce.number().int().min(1).max(20).optional().default(5),
});

const SuggestBodySchema = z.object({
  targetIds: z.array(z.string().min(1)).min(1).max(20),
});

const DecisionBodySchema = z.object({
  targetId: z.string().min(1),
  decision: z.enum(['merge', 'link', 'reject']),
});

const ScoreBodySchema = z.object({
  entity1Id: z.string().min(1),
  entity2Id: z.string().min(1),
});

/**
 * Creates the entity reconciliation router.
 * @param sql - Postgres client instance
 * @returns Hono router
 */
export function makeEntityReconciliationRouter(sql: ReturnType<typeof postgres>) {
  const router = new Hono();
  const svc = new EntityReconciler(sql);

  router.get('/entities/:entityId/matches', async (c) => {
    const { entityId } = c.req.param();
    const parsed = FindMatchesSchema.safeParse(Object.fromEntries(new URLSearchParams(c.req.url.split('?')[1] ?? '')));
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.findMatchCandidates(entityId, parsed.data.topK);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  router.post('/entities/:entityId/suggest-reconciliation', async (c) => {
    const { entityId } = c.req.param();
    const body = await c.req.json().catch(() => null);
    const parsed = SuggestBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.suggestReconciliation(entityId, parsed.data.targetIds);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  router.post('/entities/:entityId/reconciliation-decision', async (c) => {
    const { entityId } = c.req.param();
    const body = await c.req.json().catch(() => null);
    const parsed = DecisionBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.recordReconciliationDecision(entityId, parsed.data.targetId, parsed.data.decision);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.post('/reconciliation/score', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ScoreBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.scoreMatchConfidenceBetween(parsed.data.entity1Id, parsed.data.entity2Id);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  router.get('/reconciliation/pending', async (c) => {
    const result = await svc.listPendingReconciliations();
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return router;
}
