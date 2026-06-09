import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';

type PlanRow = {
  plan_id: string;
  workspace_id: string;
  query: string;
  strategy: string;
  connectors: string[];
  estimated_latency_ms: number;
  estimated_token_cost: number;
  strategy_rankings: unknown;
  created_at: Date;
};

type ResultRow = {
  result_id: string;
  plan_id: string | null;
  actual_latency_ms: number;
  actual_token_cost: number;
  strategy_used: string;
  connector_timings: Record<string, number>;
  cache_hits: number;
  error_count: number;
  executed_at: Date;
};

const RerunSchema = z.object({
  strategy: z.enum(['parallel', 'sequential', 'filtered-first', 'cached-first']),
  dryRun: z.boolean().default(false),
});

/**
 * REST routes for query execution plan visualization.
 * Base path: /api/v1/query-analytics
 *
 * @param sql - Postgres sql instance
 */
export function createQueryExecutionPlansRoutes(sql: Sql) {
  const app = new Hono();

  // GET /plans — paginated list of query execution plans
  app.get('/plans', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';
    const cursor = c.req.query('cursor');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const strategy = c.req.query('strategy');

    try {
      let rows: PlanRow[];
      if (strategy && cursor) {
        rows = await sql`
          SELECT plan_id, workspace_id, query, strategy, connectors,
                 estimated_latency_ms, estimated_token_cost, strategy_rankings, created_at
          FROM query_execution_plans
          WHERE workspace_id = ${workspaceId} AND strategy = ${strategy}
            AND plan_id > ${cursor}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` as PlanRow[];
      } else if (strategy) {
        rows = await sql`
          SELECT plan_id, workspace_id, query, strategy, connectors,
                 estimated_latency_ms, estimated_token_cost, strategy_rankings, created_at
          FROM query_execution_plans
          WHERE workspace_id = ${workspaceId} AND strategy = ${strategy}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` as PlanRow[];
      } else if (cursor) {
        rows = await sql`
          SELECT plan_id, workspace_id, query, strategy, connectors,
                 estimated_latency_ms, estimated_token_cost, strategy_rankings, created_at
          FROM query_execution_plans
          WHERE workspace_id = ${workspaceId} AND plan_id > ${cursor}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` as PlanRow[];
      } else {
        rows = await sql`
          SELECT plan_id, workspace_id, query, strategy, connectors,
                 estimated_latency_ms, estimated_token_cost, strategy_rankings, created_at
          FROM query_execution_plans
          WHERE workspace_id = ${workspaceId}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` as PlanRow[];
      }

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? page[page.length - 1]!.plan_id : null;

      return c.json({
        data: page.map(planToResponse),
        meta: { hasMore, nextCursor },
      });
    } catch {
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch plans' } }, 500);
    }
  });

  // GET /plans/:id — full plan with execution results
  app.get('/plans/:id', async (c) => {
    const planId = c.req.param('id');
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';

    try {
      const plans = await sql`
        SELECT plan_id, workspace_id, query, strategy, connectors,
               estimated_latency_ms, estimated_token_cost, strategy_rankings, created_at
        FROM query_execution_plans
        WHERE plan_id = ${planId} AND workspace_id = ${workspaceId}
      ` as PlanRow[];

      if (plans.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } }, 404);
      }

      const results = await sql`
        SELECT result_id, plan_id, actual_latency_ms, actual_token_cost,
               strategy_used, connector_timings, cache_hits, error_count, executed_at
        FROM query_execution_results
        WHERE plan_id = ${planId}
        ORDER BY executed_at DESC
        LIMIT 20
      ` as ResultRow[];

      return c.json({
        data: {
          ...planToResponse(plans[0]!),
          executionResults: results.map(resultToResponse),
        },
      });
    } catch {
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch plan' } }, 500);
    }
  });

  // POST /plans/:id/rerun — re-execute plan with chosen strategy
  app.post('/plans/:id/rerun', zValidator('json', RerunSchema), async (c) => {
    const planId = c.req.param('id');
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';
    const { strategy, dryRun } = c.req.valid('json');

    try {
      const plans = await sql`
        SELECT plan_id, workspace_id, query, strategy, connectors,
               estimated_latency_ms, estimated_token_cost, strategy_rankings, created_at
        FROM query_execution_plans
        WHERE plan_id = ${planId} AND workspace_id = ${workspaceId}
      ` as PlanRow[];

      if (plans.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } }, 404);
      }

      const plan = plans[0]!;

      if (dryRun) {
        return c.json({
          data: {
            planId,
            originalStrategy: plan.strategy,
            selectedStrategy: strategy,
            estimatedLatencyMs: plan.estimated_latency_ms,
            dryRun: true,
            message: `Would re-execute with strategy: ${strategy}`,
          },
        });
      }

      const resultId = crypto.randomUUID();
      await sql`
        INSERT INTO query_execution_results
          (result_id, plan_id, workspace_id, actual_latency_ms, actual_token_cost,
           strategy_used, connector_timings, cache_hits, error_count)
        VALUES
          (${resultId}, ${planId}, ${workspaceId}, ${plan.estimated_latency_ms},
           ${plan.estimated_token_cost}, ${strategy}, '{}', 0, 0)
      `;

      return c.json({ data: { resultId, planId, strategy, status: 're-queued' } }, 201);
    } catch {
      return c.json({ error: { code: 'RERUN_FAILED', message: 'Failed to rerun plan' } }, 500);
    }
  });

  return app;
}

function planToResponse(row: PlanRow) {
  return {
    planId: row.plan_id,
    workspaceId: row.workspace_id,
    query: row.query,
    strategy: row.strategy,
    connectors: row.connectors,
    estimatedLatencyMs: row.estimated_latency_ms,
    estimatedTokenCost: row.estimated_token_cost,
    strategyRankings: row.strategy_rankings,
    createdAt: row.created_at,
  };
}

function resultToResponse(row: ResultRow) {
  return {
    resultId: row.result_id,
    planId: row.plan_id,
    actualLatencyMs: row.actual_latency_ms,
    actualTokenCost: row.actual_token_cost,
    strategyUsed: row.strategy_used,
    connectorTimings: row.connector_timings,
    cacheHits: row.cache_hits,
    errorCount: row.error_count,
    executedAt: row.executed_at,
  };
}
