import { Hono } from 'hono';
import { z } from 'zod';
import type { VectorStore } from '@iris/semantic-core';
import { compress, serializeEntity } from '@iris/compression';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'entities' });

const listQuerySchema = z.object({
  entityType: z.string().min(1),
  workspaceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

const getQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

/**
 * @param vectorStore - Initialized vector store (injected at server startup)
 */
export function createEntityRoutes(vectorStore: VectorStore): Hono {
  const routes = new Hono();

  /** GET /api/v1/entities?entityType=&workspaceId=&limit= */
  routes.get('/', async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.errors } },
        400,
      );
    }
    const { entityType, workspaceId, limit } = parsed.data;

    const entities = await vectorStore.listByType(workspaceId, entityType, limit);
    const compressed = compress(entities, { contextBudget: 4000 });

    log.info('Entities listed', { workspaceId, entityType, count: compressed.entityCount });
    return c.json({
      data: entities.slice(0, compressed.entityCount),
      meta: { count: compressed.entityCount, truncated: compressed.truncated },
    });
  });

  /** GET /api/v1/entities/:id?workspaceId= */
  routes.get('/:id', async (c) => {
    const parsed = getQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } },
        400,
      );
    }
    const id = c.req.param('id');
    const { workspaceId } = parsed.data;

    const entity = await vectorStore.getById(workspaceId, id);
    if (!entity) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Entity "${id}" not found` } }, 404);
    }

    return c.json({ data: { entity, serialized: serializeEntity(entity) } });
  });

  return routes;
}
