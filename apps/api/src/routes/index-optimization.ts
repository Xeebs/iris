import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { IndexOptimizer } from '@iris/semantic-core/index-optimizer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'index-optimization' });

type SqlClient = ReturnType<typeof postgres>;

const querySchema = z.object({
  workspaceId: z.string().min(1),
  lookbackDays: z.coerce.number().int().positive().max(90).optional(),
});

/**
 * @param sql - Postgres client
 */
export function createIndexOptimizationRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const optimizer = new IndexOptimizer(sql);

  /**
   * GET /api/v1/index/optimize?workspaceId=&lookbackDays=7
   * Returns optimization report with hot entities and suggestions.
   */
  routes.get('/optimize', async (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required', details: parsed.error.errors } },
        400,
      );
    }

    const { workspaceId, lookbackDays } = parsed.data;
    const result = await optimizer.analyze(workspaceId, lookbackDays);

    if (result.isErr()) {
      log.error('Index optimization analysis failed', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Analysis failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  return routes;
}
