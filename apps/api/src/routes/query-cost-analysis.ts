import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import {
  QueryCostEstimator,
  type Provider,
  type OutputFormat,
} from '@iris/semantic-core/query-cost-estimator';
import type { Sql } from 'postgres';
import crypto from 'node:crypto';

const log = logger.child({ service: 'query-cost-analysis-routes' });

const EstimateCostBody = z.object({
  query: z.string().min(1).max(2000),
  provider: z.enum(['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'claude-3-haiku']).default('gpt-4o-mini'),
  entityCount: z.number().int().min(0).max(500).default(20),
  format: z.enum(['json', 'prose', 'table', 'bullets']).default('json'),
});

const CostHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createQueryCostAnalysisRoutes(sql: Sql) {
  const router = new Hono();
  const estimator = new QueryCostEstimator(sql as never);

  router.post('/estimate-cost', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const parsed = EstimateCostBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.format() } }, 400);
    }

    const { query, provider, entityCount, format } = parsed.data;
    const queryHash = crypto.createHash('sha256').update(`${workspaceId}:${query}`).digest('hex').slice(0, 32);

    log.info('Estimating query cost', { workspaceId, provider, entityCount });

    const result = await estimator.estimateQueryCost(
      queryHash,
      query,
      provider as Provider,
      entityCount,
      format as OutputFormat,
    );

    if (result.isErr()) {
      log.error('Cost estimation failed', { error: result.error.message });
      return c.json({ error: { code: 'ESTIMATION_FAILED', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value }, 200);
  });

  router.get('/cost-history', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const parsed = CostHistoryQuery.safeParse({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
    });

    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.format() } }, 400);
    }

    const { limit, cursor } = parsed.data;
    const result = await estimator.getCostHistory(workspaceId, limit, cursor);

    if (result.isErr()) {
      log.error('Cost history fetch failed', { error: result.error.message });
      return c.json({ error: { code: 'FETCH_FAILED', message: result.error.message } }, 500);
    }

    const { entries, nextCursor, hasMore } = result.value;
    return c.json({
      data: entries,
      meta: { nextCursor, hasMore },
    });
  });

  return router;
}
