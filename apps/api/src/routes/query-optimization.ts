import { Hono } from 'hono';
import { z } from 'zod';
import {
  buildExecutionPlan,
  getOptimizerStats,
  recordPlanExecution,
} from '@iris/semantic-core/query-optimizer';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ route: 'query-optimization' });

const optimizeSchema = z.object({
  query: z.string().min(1).max(2000),
  filters: z.record(z.unknown()).default({}),
});

const recordSchema = z.object({
  queryHash: z.string().min(1),
  strategy: z.enum(['vector_search_only', 'graph_expansion_first', 'cache_check_first', 'parallel_hybrid']),
  estimatedTotalTokens: z.number().int().min(0),
  estimatedTotalLatencyMs: z.number().int().min(0),
  actualTokens: z.number().int().min(0),
  actualLatencyMs: z.number().int().min(0),
  cacheHit: z.boolean().default(false),
});

/**
 * Create Hono routes for query optimization endpoints.
 * @param sql - Postgres client
 * @returns Hono app with optimization routes mounted
 */
export function createQueryOptimizationRoutes(sql: SqlFn) {
  const app = new Hono();

  // POST /queries/optimize — explain and return execution plan for a query
  app.post('/queries/optimize', async (c) => {
    const body = await c.req.json().catch(() => ({})) as unknown;
    const parsed = optimizeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'query is required' } }, 400);
    }
    const plan = buildExecutionPlan(parsed.data.query, parsed.data.filters);
    log.info('Query plan built', { queryHash: plan.queryHash, strategy: plan.strategy });
    return c.json({ data: plan });
  });

  // POST /queries/optimizer/record — record actual execution result for learning
  app.post('/queries/optimizer/record', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => ({})) as unknown;
    const parsed = recordSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid record payload' } }, 400);
    }
    const plan = {
      queryHash: parsed.data.queryHash,
      strategy: parsed.data.strategy,
      steps: [],
      estimatedTotalTokens: parsed.data.estimatedTotalTokens,
      estimatedTotalLatencyMs: parsed.data.estimatedTotalLatencyMs,
      reasoning: '',
    };
    const result = await recordPlanExecution(
      sql, plan, workspaceId,
      parsed.data.actualTokens, parsed.data.actualLatencyMs, parsed.data.cacheHit,
    );
    if (result.isErr()) {
      return c.json({ error: { code: 'RECORD_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { recorded: true } }, 201);
  });

  // GET /query-optimizer/stats — optimizer effectiveness metrics
  app.get('/query-optimizer/stats', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const result = await getOptimizerStats(sql, workspaceId);
    if (result.isErr()) {
      log.error('Failed to get optimizer stats', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'STATS_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
