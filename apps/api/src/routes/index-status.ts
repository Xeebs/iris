import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { IndexStatusService } from '@iris/semantic-core';

const log = logger.child({ route: 'index-status' });

const querySchema = z.object({
  workspaceId: z.string().min(1),
});

type SqlClient = ReturnType<typeof postgres>;

/**
 * @param sql - Postgres client
 */
export function createIndexStatusRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const service = new IndexStatusService(sql);

  /** GET /api/v1/index/status?workspaceId= */
  routes.get('/status', async (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } },
        400,
      );
    }

    const { workspaceId } = parsed.data;
    const result = await service.getIndexStatus(workspaceId);

    if (result.isErr()) {
      log.error('Failed to fetch index status', { workspaceId, error: result.error });
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch index status' } },
        500,
      );
    }

    log.info('Index status fetched', {
      workspaceId,
      totalEntities: result.value.totalEntities,
      typeCount: result.value.coverageByType.length,
    });
    return c.json({ data: result.value });
  });

  return routes;
}
