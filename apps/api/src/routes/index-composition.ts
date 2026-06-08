import { Hono } from 'hono';
import type postgres from 'postgres';

import { IndexAnalyticsService } from '@iris/semantic-core/index-analytics';

type SqlClient = ReturnType<typeof postgres>;

/**
 * REST routes for index composition analytics.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted at /analytics/index
 */
export function createIndexCompositionRoutes(sql: SqlClient) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = () => new IndexAnalyticsService(sql as unknown as any);

  /** GET /analytics/index?workspaceId= — full analytics report */
  app.get('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } }, 400);
    }

    const [comp, fresh, quality, opps] = await Promise.allSettled([
      svc().getCompositionMetrics(workspaceId),
      svc().getFreshnessMetrics(workspaceId),
      svc().getQualityMetrics(workspaceId),
      svc().getOptimizationOpportunities(workspaceId),
    ]);

    if (comp.status === 'rejected' || fresh.status === 'rejected') {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Analytics query failed' } }, 500);
    }

    const compVal = comp.value;
    const freshVal = fresh.value;
    const qualityVal = quality.status === 'fulfilled' ? quality.value : null;
    const oppsVal = opps.status === 'fulfilled' ? opps.value : null;

    if (compVal.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: compVal.error.message } }, 500);
    if (freshVal.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: freshVal.error.message } }, 500);

    return c.json({
      data: {
        composition: compVal.value,
        freshness: freshVal.value,
        quality: qualityVal?.isOk() ? qualityVal.value : null,
        opportunities: oppsVal?.isOk() ? oppsVal.value : [],
      },
    });
  });

  /** GET /analytics/index/snapshots?workspaceId=&days= */
  app.get('/snapshots', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } }, 400);
    }
    const days = parseInt(c.req.query('days') ?? '30', 10);
    const result = await svc().getSnapshots(workspaceId, days);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return app;
}
