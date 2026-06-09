import { Hono } from 'hono';
import type postgres from 'postgres';
import { CostOptimizationAdvisor } from '@iris/semantic-core/cost-optimizer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'cost-analytics' });

type SqlClient = ReturnType<typeof postgres>;

/**
 * @param sql - Postgres client
 * @returns Hono router for cost attribution and recommendation endpoints
 */
export function createCostAnalyticsRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const advisor = new CostOptimizationAdvisor(sql as unknown as ReturnType<typeof postgres>);

  /** GET /cost-analytics/breakdown — cost breakdown by connector, entity type, trend */
  app.get('/breakdown', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const windowDays = Math.min(parseInt(c.req.query('days') ?? '30', 10), 90);

    try {
      const breakdown = await advisor.attributeCosts(workspaceId, windowDays);
      return c.json({ data: breakdown });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to fetch cost breakdown', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch cost breakdown' } }, 500);
    }
  });

  /** GET /cost-analytics/recommendations — ranked optimization recommendations */
  app.get('/recommendations', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const windowDays = Math.min(parseInt(c.req.query('days') ?? '30', 10), 90);

    try {
      const result = await advisor.recommend(workspaceId, windowDays);
      if (result.isErr()) {
        return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
      }
      return c.json({ data: result.value });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to generate recommendations', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to generate recommendations' } }, 500);
    }
  });

  /** POST /cost-analytics/recommendations/:id/apply — mark a recommendation as applied */
  app.post('/recommendations/:id/apply', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { id } = c.req.param();
    let savingsRealizedCents = 0;
    try {
      const body = (await c.req.json()) as { savingsRealizedCents?: number };
      savingsRealizedCents = body.savingsRealizedCents ?? 0;
    } catch { /* body is optional */ }

    try {
      const result = await advisor.applyRecommendation(workspaceId, id, savingsRealizedCents);
      if (result.isErr()) {
        return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
      }
      return c.json({ data: { applied: true, recommendationId: id } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to apply recommendation', { workspaceId, id, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to apply recommendation' } }, 500);
    }
  });

  return app;
}
