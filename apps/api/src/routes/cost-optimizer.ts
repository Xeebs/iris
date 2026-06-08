import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { CostOptimizationAdvisor } from '@iris/semantic-core/cost-optimizer';

const log = logger.child({ route: 'cost-optimizer' });

type SqlClient = ReturnType<typeof postgres>;

const recommendationsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});

const applySchema = z.object({
  recommendationId: z.string().min(1),
  savingsRealizedCents: z.number().min(0).default(0),
});

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /cost-optimizer
 */
export function createCostOptimizerRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const advisor = new CostOptimizationAdvisor(sql);

  /** GET /cost-optimizer/recommendations — analyze spend and return recommendations */
  app.get('/recommendations', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const parsed = recommendationsQuerySchema.safeParse(Object.fromEntries(
      new URL(c.req.url, 'http://localhost').searchParams,
    ));

    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { windowDays } = parsed.data;

    const patternResult = await advisor.analyzeSpendPatterns(workspaceId, windowDays);
    if (patternResult.isErr()) {
      log.error('Failed to analyze spend', { workspaceId, error: patternResult.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to analyze spend patterns' } }, 500);
    }

    const recResult = await advisor.generateRecommendations(patternResult.value);
    if (recResult.isErr()) {
      log.error('Failed to generate recommendations', { workspaceId, error: recResult.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to generate recommendations' } }, 500);
    }

    return c.json({
      data: {
        spendSummary: patternResult.value,
        recommendations: recResult.value,
      },
    });
  });

  /** POST /cost-optimizer/apply — mark a recommendation as applied */
  app.post('/apply', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const body = await c.req.json().catch(() => null);

    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = applySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await advisor.applyRecommendation(
      workspaceId,
      parsed.data.recommendationId,
      parsed.data.savingsRealizedCents,
    );

    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to apply recommendation' } }, 500);
    }

    log.info('Recommendation applied via API', { workspaceId, recommendationId: parsed.data.recommendationId });
    return c.json({ data: { applied: true, recommendationId: parsed.data.recommendationId } });
  });

  return app;
}
