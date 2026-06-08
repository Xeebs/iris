import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { DataLineageService } from '@iris/semantic-core/data-lineage';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ route: 'entity-lineage' });

const ListQuerySchema = z.object({
  workspaceId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

/**
 * Create routes for data lineage / provenance tracking.
 * Mounted at /entities/:id/lineage and /lineage
 *
 * @param sql - Postgres client
 */
export function createEntityLineageRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const service = new DataLineageService(sql);

  /** GET /entities/:id/lineage?workspaceId=xxx — get full provenance chain for one entity */
  app.get('/:id/lineage', async (c) => {
    const entityId = c.req.param('id');
    const workspaceId = c.req.query('workspaceId');

    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const record = await service.getLineage(entityId, workspaceId);
    return c.json({ data: record }, 200);
  });

  /** GET /lineage?workspaceId=xxx&limit=50&cursor=<ts> — list lineage records for a workspace */
  app.get('/', async (c) => {
    const parsed = ListQuerySchema.safeParse({
      workspaceId: c.req.query('workspaceId'),
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
    });

    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, limit, cursor } = parsed.data;
    const records = await service.listEntityLineage(workspaceId, limit, cursor);

    const nextCursor = records.length === limit
      ? records[records.length - 1]?.lastModifiedAt.toISOString()
      : undefined;

    log.debug('Listed entity lineage', { workspaceId, count: records.length });

    return c.json({
      data: records,
      meta: { hasMore: records.length === limit, ...(nextCursor !== undefined ? { nextCursor } : {}) },
    }, 200);
  });

  return app;
}
