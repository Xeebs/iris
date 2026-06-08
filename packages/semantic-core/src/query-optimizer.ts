import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-optimizer' });

export type ExecutionStrategy =
  | 'vector_search_only'
  | 'graph_expansion_first'
  | 'cache_check_first'
  | 'parallel_hybrid';

export type QueryAnalysis = {
  query: string;
  estimatedSelectivity: number;  // 0–1; lower = more selective
  expectedResultSize: number;
  cacheHitLikelihood: number;    // 0–1
  hasEntityTypeFilter: boolean;
  hasAttributeFilters: boolean;
  isAggregation: boolean;
  complexityScore: number;       // 0–1
};

export type ExecutionStep = {
  stepId: string;
  strategy: ExecutionStrategy;
  description: string;
  estimatedTokens: number;
  estimatedLatencyMs: number;
  fallback?: ExecutionStep;
};

export type ExecutionPlan = {
  queryHash: string;
  strategy: ExecutionStrategy;
  steps: ExecutionStep[];
  estimatedTotalTokens: number;
  estimatedTotalLatencyMs: number;
  reasoning: string;
};

export type OptimizerStats = {
  workspaceId: string;
  totalPlans: number;
  strategyBreakdown: Record<ExecutionStrategy, number>;
  avgTokensSaved: number;
  avgLatencyImprovementMs: number;
  cacheHitRate: number;
  slowestQueries: Array<{ queryHash: string; avgLatencyMs: number; strategy: ExecutionStrategy }>;
};

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

/** Simple FNV-1a 32-bit hash for query strings. */
function hashQuery(query: string): string {
  let h = 2166136261;
  for (let i = 0; i < query.length; i++) {
    h ^= query.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Analyzes a query string and its filters to estimate selectivity, result size,
 * cache hit likelihood, and complexity.
 * @param query - Natural language or structured query string
 * @param filters - Key-value filter map applied to the query
 * @returns Query analysis metrics
 */
export function analyzeQueryPattern(
  query: string,
  filters: Record<string, unknown> = {},
): QueryAnalysis {
  const lq = query.toLowerCase();
  const filterCount = Object.keys(filters).length;

  // Heuristics for selectivity: specific IDs/names → more selective
  const hasSpecificId = /\b(id|uuid|email)[:=]/.test(lq) || /[a-f0-9]{8}-[a-f0-9]{4}/.test(lq);
  const hasNameMatch = /\b(named?|called|"[^"]+")/.test(lq);
  const hasDateRange = /\b(this|last|past)\s+(week|month|quarter|year)\b/.test(lq);

  const estimatedSelectivity = hasSpecificId ? 0.05
    : hasNameMatch ? 0.2
    : hasDateRange ? 0.4
    : filterCount > 2 ? 0.3
    : filterCount > 0 ? 0.5
    : 0.8;

  const expectedResultSize = Math.round(estimatedSelectivity * 1000);

  // Cache hit likelihood: simple queries with stable terms hit cache more.
  // Date-range queries are never cacheable (results change every run).
  const isSimple = lq.length < 60 && filterCount === 0;
  const cacheHitLikelihood = hasDateRange ? 0.1 : isSimple ? 0.7 : 0.35;

  const isAggregation = /\b(sum|count|total|average|avg|top \d+|by (month|quarter|year))\b/.test(lq);
  const hasEntityTypeFilter = 'type' in filters || /\b(contacts?|deals?|companies?|tickets?|leads?)\b/.test(lq);
  const hasAttributeFilters = filterCount > 0;
  const complexityScore = Math.min(1, (filterCount * 0.1) + (lq.length / 200) + (isAggregation ? 0.3 : 0));

  return {
    query,
    estimatedSelectivity,
    expectedResultSize,
    cacheHitLikelihood,
    hasEntityTypeFilter,
    hasAttributeFilters,
    isAggregation,
    complexityScore,
  };
}

/**
 * Select the optimal execution strategy based on a query analysis.
 * @param analysis - Output from analyzeQueryPattern
 * @returns Chosen execution strategy
 */
export function selectExecutionStrategy(analysis: QueryAnalysis): ExecutionStrategy {
  if (analysis.cacheHitLikelihood >= 0.6) {
    return 'cache_check_first';
  }
  if (analysis.complexityScore >= 0.6 || analysis.isAggregation) {
    return 'parallel_hybrid';
  }
  if (analysis.hasEntityTypeFilter && analysis.estimatedSelectivity < 0.3) {
    return 'graph_expansion_first';
  }
  return 'vector_search_only';
}

/**
 * Estimate token and latency cost for a given strategy and analysis.
 * @param strategy - Chosen execution strategy
 * @param analysis - Query analysis metrics
 * @returns Estimated token cost and latency in ms
 */
export function estimateCost(
  strategy: ExecutionStrategy,
  analysis: QueryAnalysis,
): { estimatedTokens: number; estimatedLatencyMs: number } {
  const baseTokens = 100 + Math.round(analysis.expectedResultSize * 3);
  const baseLatencyMs = 50 + Math.round(analysis.complexityScore * 500);

  switch (strategy) {
    case 'cache_check_first':
      return { estimatedTokens: 10, estimatedLatencyMs: 20 };
    case 'vector_search_only':
      return { estimatedTokens: baseTokens, estimatedLatencyMs: baseLatencyMs };
    case 'graph_expansion_first':
      return {
        estimatedTokens: Math.round(baseTokens * 1.5),
        estimatedLatencyMs: Math.round(baseLatencyMs * 1.8),
      };
    case 'parallel_hybrid':
      return {
        estimatedTokens: Math.round(baseTokens * 2),
        estimatedLatencyMs: Math.round(baseLatencyMs * 1.3),
      };
  }
}

/**
 * Build a full execution plan for a query with ordered steps and fallbacks.
 * @param query - Natural language query string
 * @param filters - Filters to apply
 * @returns Full execution plan
 */
export function buildExecutionPlan(
  query: string,
  filters: Record<string, unknown> = {},
): ExecutionPlan {
  const analysis = analyzeQueryPattern(query, filters);
  const strategy = selectExecutionStrategy(analysis);
  const cost = estimateCost(strategy, analysis);
  const queryHash = hashQuery(query);

  const fallbackStep: ExecutionStep = {
    stepId: 'fallback-vector',
    strategy: 'vector_search_only',
    description: 'Fallback: direct vector similarity search',
    estimatedTokens: cost.estimatedTokens,
    estimatedLatencyMs: cost.estimatedLatencyMs + 200,
  };

  let steps: ExecutionStep[];
  let reasoning: string;

  switch (strategy) {
    case 'cache_check_first':
      steps = [
        {
          stepId: 'cache-lookup',
          strategy: 'cache_check_first',
          description: 'Check semantic cache for similar query (0.92 threshold)',
          estimatedTokens: 10,
          estimatedLatencyMs: 20,
          fallback: fallbackStep,
        },
      ];
      reasoning = `High cache hit likelihood (${(analysis.cacheHitLikelihood * 100).toFixed(0)}%) — try cache first to avoid embedding cost.`;
      break;

    case 'graph_expansion_first':
      steps = [
        {
          stepId: 'graph-traverse',
          strategy: 'graph_expansion_first',
          description: 'Traverse knowledge graph from entity type anchor',
          estimatedTokens: 50,
          estimatedLatencyMs: 80,
          fallback: fallbackStep,
        },
        {
          stepId: 'vector-refine',
          strategy: 'vector_search_only',
          description: 'Refine results with semantic similarity',
          estimatedTokens: cost.estimatedTokens,
          estimatedLatencyMs: cost.estimatedLatencyMs,
        },
      ];
      reasoning = `Entity type filter present with high selectivity (${(analysis.estimatedSelectivity * 100).toFixed(0)}%) — graph traversal reduces search space.`;
      break;

    case 'parallel_hybrid':
      steps = [
        {
          stepId: 'parallel-all',
          strategy: 'parallel_hybrid',
          description: 'Execute vector search + graph expansion + cache check in parallel, merge results',
          estimatedTokens: cost.estimatedTokens,
          estimatedLatencyMs: cost.estimatedLatencyMs,
        },
      ];
      reasoning = `Complex aggregation query (score ${analysis.complexityScore.toFixed(2)}) — parallel execution covers all angles and merges best results.`;
      break;

    default:
      steps = [
        {
          stepId: 'vector-search',
          strategy: 'vector_search_only',
          description: 'Semantic vector similarity search (HNSW)',
          estimatedTokens: cost.estimatedTokens,
          estimatedLatencyMs: cost.estimatedLatencyMs,
        },
      ];
      reasoning = 'General query without strong selectivity signals — direct vector search is most efficient.';
  }

  return {
    queryHash,
    strategy,
    steps,
    estimatedTotalTokens: cost.estimatedTokens,
    estimatedTotalLatencyMs: cost.estimatedLatencyMs,
    reasoning,
  };
}

/**
 * Persists a query execution plan result to the database for analytics and learning.
 * @param sql - Tagged template SQL function
 * @param plan - Execution plan that was used
 * @param workspaceId - Workspace context
 * @param actualTokens - Actual tokens consumed
 * @param actualLatencyMs - Actual end-to-end latency
 * @param cacheHit - Whether the cache was hit
 */
export async function recordPlanExecution(
  sql: SqlFn,
  plan: ExecutionPlan,
  workspaceId: string,
  actualTokens: number,
  actualLatencyMs: number,
  cacheHit: boolean,
): Promise<Result<void, Error>> {
  try {
    await sql`
      INSERT INTO query_execution_plans
        (query_hash, workspace_id, strategy_chosen, estimated_cost_tokens,
         actual_cost_tokens, latency_ms, cache_hit)
      VALUES (
        ${plan.queryHash}, ${workspaceId}, ${plan.strategy},
        ${plan.estimatedTotalTokens}, ${actualTokens}, ${actualLatencyMs}, ${cacheHit}
      )
    `;
    log.debug('Plan execution recorded', { queryHash: plan.queryHash, workspaceId, strategy: plan.strategy });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Fetches aggregate optimizer statistics for a workspace.
 * @param sql - Tagged template SQL function
 * @param workspaceId - Workspace to query
 * @returns Optimizer effectiveness stats
 */
export async function getOptimizerStats(
  sql: SqlFn,
  workspaceId: string,
): Promise<Result<OptimizerStats, Error>> {
  try {
    const rows = await sql`
      SELECT
        strategy_chosen,
        COUNT(*) AS plan_count,
        AVG(actual_cost_tokens) AS avg_actual_tokens,
        AVG(estimated_cost_tokens) AS avg_est_tokens,
        AVG(latency_ms) AS avg_latency,
        AVG(CASE WHEN cache_hit THEN 1 ELSE 0 END) AS cache_hit_rate
      FROM query_execution_plans
      WHERE workspace_id = ${workspaceId}
      GROUP BY strategy_chosen
    ` as unknown as Array<{
      strategy_chosen: ExecutionStrategy;
      plan_count: string;
      avg_actual_tokens: string;
      avg_est_tokens: string;
      avg_latency: string;
      cache_hit_rate: string;
    }>;

    const slowRows = await sql`
      SELECT query_hash, strategy_chosen, AVG(latency_ms) AS avg_latency
      FROM query_execution_plans
      WHERE workspace_id = ${workspaceId}
      GROUP BY query_hash, strategy_chosen
      ORDER BY avg_latency DESC
      LIMIT 5
    ` as unknown as Array<{ query_hash: string; strategy_chosen: ExecutionStrategy; avg_latency: string }>;

    const strategyBreakdown: Record<ExecutionStrategy, number> = {
      vector_search_only: 0,
      graph_expansion_first: 0,
      cache_check_first: 0,
      parallel_hybrid: 0,
    };
    let totalPlans = 0;
    let totalTokensSaved = 0;
    let totalCacheHitRate = 0;

    for (const row of rows) {
      const count = parseInt(row.plan_count, 10);
      strategyBreakdown[row.strategy_chosen] = count;
      totalPlans += count;
      totalTokensSaved += (parseFloat(row.avg_est_tokens) - parseFloat(row.avg_actual_tokens)) * count;
      totalCacheHitRate += parseFloat(row.cache_hit_rate) * count;
    }

    return ok({
      workspaceId,
      totalPlans,
      strategyBreakdown,
      avgTokensSaved: totalPlans > 0 ? Math.round(totalTokensSaved / totalPlans) : 0,
      avgLatencyImprovementMs: 0,
      cacheHitRate: totalPlans > 0 ? totalCacheHitRate / totalPlans : 0,
      slowestQueries: slowRows.map(r => ({
        queryHash: r.query_hash,
        avgLatencyMs: Math.round(parseFloat(r.avg_latency)),
        strategy: r.strategy_chosen,
      })),
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
