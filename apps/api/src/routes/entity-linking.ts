import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { EntityLinker } from '@iris/semantic-core/entity-linker';

const log = logger.child({ route: 'entity-linking' });

type SqlClient = ReturnType<typeof postgres>;

const updateStatusSchema = z.object({
  status: z.enum(['confirmed', 'rejected']),
});

const analyzeSchema = z.object({
  entityType: z.string().optional(),
  threshold: z.coerce.number().min(0).max(1).default(0.70),
});

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /admin/entity-linking
 */
export function createEntityLinkingRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /admin/entity-linking/links — list cross-connector links */
  app.get('/links', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';
    const statusParam = c.req.query('status') as 'proposed' | 'confirmed' | 'rejected' | undefined;
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    const linker = new EntityLinker(sql as ConstructorParameters<typeof EntityLinker>[0]);
    const result = await linker.listLinks(workspaceId, statusParam, limit);
    if (result.isErr()) {
      log.error('Failed to list entity links', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list entity links' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /admin/entity-linking/analyze — trigger cross-connector analysis */
  app.post('/analyze', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';
    const body = await c.req.json().catch(() => ({}));
    const parsed = analyzeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const linker = new EntityLinker(sql as ConstructorParameters<typeof EntityLinker>[0]);
    const result = await linker.analyzeEntityConnections(workspaceId, parsed.data.entityType, parsed.data.threshold);
    if (result.isErr()) {
      log.error('Entity link analysis failed', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Analysis failed' } }, 500);
    }
    return c.json({ data: { proposalsCreated: result.value } });
  });

  /** PUT /admin/entity-linking/links/:id — confirm or reject a link */
  app.put('/links/:id', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id') ?? 'default';
    const linkId = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = updateStatusSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const linker = new EntityLinker(sql as ConstructorParameters<typeof EntityLinker>[0]);
    const result = await linker.updateLinkStatus(workspaceId, linkId, parsed.data.status);
    if (result.isErr()) {
      const isNotFound = result.error.message.includes('not found');
      return c.json({ error: { code: isNotFound ? 'NOT_FOUND' : 'INTERNAL_ERROR', message: result.error.message } },
        isNotFound ? 404 : 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
