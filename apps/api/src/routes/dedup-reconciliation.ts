import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { DedupReconciliationService } from '@iris/semantic-core/dedup-reconciliation';

type SqlClient = ReturnType<typeof postgres>;

const decisionSchema = z.object({
  decision: z.enum(['merge', 'keep_separate', 'ignore']),
  decidedBy: z.string().min(1),
});

const listQuerySchema = z.object({
  status: z.enum(['pending', 'reviewed', 'merged', 'undone']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const mergeBodySchema = z.object({
  survivingEntityId: z.string().min(1),
  mergedEntityId: z.string().min(1),
  mergedBy: z.string().min(1),
});

/**
 * REST routes for entity deduplication review and reconciliation.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createDedupRoutes(sql: SqlClient) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new DedupReconciliationService(sql as unknown as any);

  const getWorkspaceId = (c: Context) =>
    (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');

  /** GET /dedup/candidates — list pending/reviewed candidates */
  app.get('/candidates', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.listCandidates(
      workspaceId,
      parsed.data.status ?? 'pending',
      parsed.data.limit ?? 50,
      parsed.data.cursor,
    );
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    const items = result.value;
    const nextCursor = items.length > 0 ? items[items.length - 1]?.id : null;
    return c.json({ data: items, meta: { nextCursor, hasMore: items.length === (parsed.data.limit ?? 50) } });
  });

  /** GET /dedup/metrics — workspace-level dedup summary */
  app.get('/metrics', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await svc.getMetrics(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /dedup/candidates/:sourceId/:dupId/decide — record a manual decision */
  app.post('/candidates/:sourceId/:dupId/decide', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.recordDecision({
      workspaceId,
      sourceEntityId: c.req.param('sourceId'),
      candidateDuplicateId: c.req.param('dupId'),
      decision: parsed.data.decision,
      decidedBy: parsed.data.decidedBy,
    });
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /dedup/merge — execute entity merge */
  app.post('/merge', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = mergeBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.executeMerge(
      workspaceId,
      parsed.data.survivingEntityId,
      parsed.data.mergedEntityId,
      parsed.data.mergedBy,
    );
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'CONFLICT', message: msg } }, 409);
    }
    return c.json({ data: result.value }, 201);
  });

  /** POST /dedup/merge/:sourceId/:dupId/undo — undo a merge within 30 days */
  app.post('/merge/:sourceId/:dupId/undo', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const result = await svc.undoMerge(
      workspaceId,
      c.req.param('sourceId'),
      c.req.param('dupId'),
    );
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found') || msg.includes('window')) {
        return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: { success: true } });
  });

  return app;
}
