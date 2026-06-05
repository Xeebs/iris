import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { TokenAnalytics } from '@iris/semantic-core';

const log = logger.child({ route: 'analytics' });

const analyticsQuerySchema = z.object({
  workspaceId: z.string().min(1),
  days: z.coerce.number().int().positive().max(365).default(30),
});

type SqlClient = ReturnType<typeof postgres>;

/**
 * @param sql - Postgres client
 */
export function createAnalyticsRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const tokenAnalytics = new TokenAnalytics(sql);

  /** GET /api/v1/analytics/tokens?workspaceId=&days= */
  routes.get('/tokens', async (c) => {
    const parsed = analyticsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'workspaceId is required',
            details: parsed.error.errors,
          },
        },
        400,
      );
    }

    const { workspaceId, days } = parsed.data;
    const result = await tokenAnalytics.getAnalytics(workspaceId, days);

    if (result.isErr()) {
      log.error('Failed to fetch token analytics', { error: result.error, workspaceId });
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch analytics' } },
        500,
      );
    }

    log.info('Token analytics fetched', { workspaceId, days, dayCount: result.value.days.length });
    return c.json({ data: result.value });
  });

  return routes;
}
