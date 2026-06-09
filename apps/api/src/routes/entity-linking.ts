import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { EntityLinker } from '@iris/semantic-core/entity-linker';

const log = logger.child({ route: 'entity-linking' });

type SqlFn = ReturnType<typeof postgres>;

const updateStatusSchema = z.object({
  status: z.enum(['confirmed', 'rejected']),
});

const analyzeSchema = z.object({
  entityType: z.string().optional(),
  threshold: z.coerce.number().min(0).max(1).default(0.70),
});

const confirmMergeSchema = z.object({
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  mergedBy: z.string().min(1).default('api'),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for entity linking and merge routes
 */
export function createEntityLinkingRoutes(sql: SqlFn): Hono {
  const app = new Hono();
  const linker = new EntityLinker(sql as unknown as ConstructorParameters<typeof EntityLinker>[0]);

  /** GET /api/v1/entity-linking/suggestions — list proposed cross-connector links */
  app.get('/suggestions', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const result = await linker.listLinks(workspaceId, 'proposed', limit);
    if (result.isErr()) {
      log.error('Failed to list entity links', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value, meta: { count: result.value.length } });
  });

  /** POST /api/v1/entity-linking/analyze — scan for cross-connector duplicates */
  app.post('/analyze', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const body = await c.req.json().catch(() => ({}));
    const parsed = analyzeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await linker.analyzeEntityConnections(workspaceId, parsed.data.entityType, parsed.data.threshold);
    if (result.isErr()) {
      log.error('Entity link analysis failed', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { proposalsCreated: result.value } }, 201);
  });

  /** PUT /api/v1/entity-linking/links/:id — confirm or reject a link */
  app.put('/links/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const linkId = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = updateStatusSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await linker.updateLinkStatus(workspaceId, linkId, parsed.data.status);
    if (result.isErr()) {
      const isNotFound = result.error.message.includes('not found');
      return c.json({ error: { code: isNotFound ? 'NOT_FOUND' : 'INTERNAL_ERROR', message: result.error.message } },
        isNotFound ? 404 : 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/entity-linking/merge — confirm and record an entity merge */
  app.post('/merge', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = confirmMergeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message, details: parsed.error.flatten() } }, 400);
    }

    const result = await linker.confirmMerge(
      parsed.data.sourceEntityId,
      parsed.data.targetEntityId,
      workspaceId,
      parsed.data.mergedBy,
    );
    if (result.isErr()) {
      log.error('Merge confirmation failed', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    log.info('Entity merge confirmed', { workspaceId, mergeId: result.value });
    return c.json({ data: { mergeId: result.value } }, 201);
  });

  /** DELETE /api/v1/entity-linking/merges/:mergeId — undo a merge */
  app.delete('/merges/:mergeId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const { mergeId } = c.req.param();
    const result = await linker.undoMerge(mergeId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { undone: true } });
  });

  /** GET /api/v1/entity-linking/history — merge audit trail */
  app.get('/history', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const result = await linker.getMergeHistory(workspaceId, limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
