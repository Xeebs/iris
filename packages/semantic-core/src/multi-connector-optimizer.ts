import type { Sql } from 'postgres';
import { randomBytes } from 'crypto';
import { logger } from '@iris/core/logger';

export type ExecutionStrategy = 'parallel' | 'sequential' | 'filtered-first' | 'cached-first';

export type ConnectorMeta = {
  connectorId: string;
  entityTypes: string[];
  avgLatencyMs: number;
  cacheHitRate: number;
  costPerRequest: number;
};

export type StrategyScore = {
  strategy: ExecutionStrategy;
  score: number;
  estimatedLatencyP95Ms: number;
  estimatedTokens: number;
  estimatedCost: number;
  pros: string[];
  cons: string[];
};

export type QueryPlan = {
  planId: string;
  workspaceId: string;
  query: string;
  strategy: ExecutionStrategy;
  connectors: string[];
  estimatedLatencyP95Ms: number;
  estimatedTokens: number;
  estimatedCost: number;
  strategyRankings: StrategyScore[];
  reasoning: string;
  createdAt: Date;
};

export type ExecutionConstraints = {
  maxLatencyMs: number;
  maxTokens: number;
  preferLowCost: boolean;
};

export type ConnectorAffinityResult = {
  connectorId: string;
  relevanceScore: number;
  matchedEntityTypes: string[];
};

type PlanRow = {
  plan_id: string;
  workspace_id: string;
  query: string;
  strategy: string;
  connectors: string[];
  estimated_latency_p95_ms: number;
  estimated_tokens: number;
  estimated_cost: number;
  strategy_rankings: StrategyScore[];
  reasoning: string;
  created_at: Date;
};

const TOKENS_PER_ENTITY = 120;
const PARALLEL_OVERHEAD_MS = 50;
const SEQUENTIAL_LATENCY_MULTIPLIER = 0.7;
const CACHE_HIT_LATENCY_MS = 8;

/**
 * Determines which entity types appear in a query via keyword match.
 */
function extractEntityKeywords(query: string): string[] {
  const lower = query.toLowerCase();
  const candidates = [
    'contact', 'company', 'deal', 'opportunity', 'lead', 'account',
    'ticket', 'order', 'invoice', 'user', 'employee', 'product',
    'campaign', 'task', 'event', 'meeting', 'project',
  ];
  return candidates.filter((k) => lower.includes(k));
}

export class MultiConnectorQueryOptimizer {
  constructor(
    private readonly sql: Sql,
    private readonly serviceName = 'multi-connector-optimizer'
  ) {}

  /**
   * Determines which connectors are relevant to a query using BFS on entity keyword overlap.
   * @param query - The natural language or semantic query string
   * @param connectors - Available connectors with metadata
   * @returns Ranked list of connector affinities
   */
  analyzeQueryConnectorAffinity(
    query: string,
    connectors: ConnectorMeta[]
  ): ConnectorAffinityResult[] {
    const keywords = extractEntityKeywords(query);
    const results: ConnectorAffinityResult[] = [];

    for (const connector of connectors) {
      const matched = connector.entityTypes.filter((t) =>
        keywords.some((k) => t.toLowerCase().includes(k) || k.includes(t.toLowerCase()))
      );

      const relevanceScore =
        keywords.length === 0
          ? 0.5
          : matched.length / Math.max(keywords.length, connector.entityTypes.length);

      results.push({
        connectorId: connector.connectorId,
        relevanceScore,
        matchedEntityTypes: matched,
      });
    }

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Scores all four execution strategies given connector list and budgets.
   * @param connectors - Connectors selected for this query
   * @param contextBudget - Maximum token budget
   * @param latencyBudget - Maximum acceptable latency in ms
   * @returns Ranked strategy scores
   */
  rankExecutionStrategies(
    connectors: ConnectorMeta[],
    contextBudget: number,
    latencyBudget: number
  ): StrategyScore[] {
    const n = connectors.length;
    if (n === 0) return [];

    const maxLatency = Math.max(...connectors.map((c) => c.avgLatencyMs));
    const totalLatency = connectors.reduce((s, c) => s + c.avgLatencyMs, 0);
    const avgCacheHit = connectors.reduce((s, c) => s + c.cacheHitRate, 0) / n;
    const totalCost = connectors.reduce((s, c) => s + c.costPerRequest, 0);

    const parallelLatency = maxLatency + PARALLEL_OVERHEAD_MS;
    const parallelTokens = n * TOKENS_PER_ENTITY * 10;
    const parallelCost = totalCost;

    const sequentialLatency = totalLatency * SEQUENTIAL_LATENCY_MULTIPLIER;
    const sequentialTokens = n * TOKENS_PER_ENTITY * 8;
    const sequentialCost = totalCost * 0.6;

    const filteredLatency = parallelLatency * 0.75;
    const filteredTokens = Math.floor(parallelTokens * 0.6);
    const filteredCost = totalCost * 0.7;

    const cachedLatency = avgCacheHit > 0 ? CACHE_HIT_LATENCY_MS + parallelLatency * (1 - avgCacheHit) : parallelLatency;
    const cachedTokens = Math.floor(parallelTokens * (1 - avgCacheHit * 0.8));
    const cachedCost = totalCost * (1 - avgCacheHit * 0.9);

    function score(latency: number, tokens: number, cost: number): number {
      const latencyScore = Math.max(0, 1 - latency / latencyBudget);
      const tokenScore = Math.max(0, 1 - tokens / contextBudget);
      const costScore = Math.max(0, 1 - cost / (totalCost + 1));
      return (latencyScore * 0.5 + tokenScore * 0.3 + costScore * 0.2);
    }

    const strategies: StrategyScore[] = [
      {
        strategy: 'parallel',
        score: score(parallelLatency, parallelTokens, parallelCost),
        estimatedLatencyP95Ms: Math.round(parallelLatency * 1.2),
        estimatedTokens: parallelTokens,
        estimatedCost: parallelCost,
        pros: ['maximum throughput', 'best latency for multi-connector'],
        cons: ['high memory usage', 'complex error handling'],
      },
      {
        strategy: 'sequential',
        score: score(sequentialLatency, sequentialTokens, sequentialCost),
        estimatedLatencyP95Ms: Math.round(sequentialLatency * 1.2),
        estimatedTokens: sequentialTokens,
        estimatedCost: sequentialCost,
        pros: ['low memory usage', 'simple retry logic'],
        cons: ['slowest execution', 'no parallelism benefit'],
      },
      {
        strategy: 'filtered-first',
        score: score(filteredLatency, filteredTokens, filteredCost),
        estimatedLatencyP95Ms: Math.round(filteredLatency * 1.2),
        estimatedTokens: filteredTokens,
        estimatedCost: filteredCost,
        pros: ['reduces result size early', 'lower token usage'],
        cons: ['requires good filter heuristics', 'may miss edge cases'],
      },
      {
        strategy: 'cached-first',
        score: score(cachedLatency, cachedTokens, cachedCost),
        estimatedLatencyP95Ms: Math.round(cachedLatency * 1.2),
        estimatedTokens: cachedTokens,
        estimatedCost: cachedCost,
        pros: ['leverages semantic cache', 'low cost on cache hit'],
        cons: ['cache miss fallback overhead', 'stale data risk'],
      },
    ];

    return strategies.sort((a, b) => b.score - a.score);
  }

  /**
   * Estimates execution cost for a specific strategy and connector list.
   * @param strategy - The execution strategy to evaluate
   * @param connectors - Connector metadata list
   * @returns Cost estimate with latency p95, tokens, and cost
   */
  estimateExecutionCost(
    strategy: ExecutionStrategy,
    connectors: ConnectorMeta[]
  ): { latencyP95Ms: number; tokens: number; cost: number } {
    const rankings = this.rankExecutionStrategies(connectors, 10000, 10000);
    const found = rankings.find((r) => r.strategy === strategy);
    if (!found) {
      return { latencyP95Ms: 0, tokens: 0, cost: 0 };
    }
    return {
      latencyP95Ms: found.estimatedLatencyP95Ms,
      tokens: found.estimatedTokens,
      cost: found.estimatedCost,
    };
  }

  /**
   * Selects the optimal strategy for a query given budget and SLA constraints.
   * @param query - The query string
   * @param connectors - Available connectors
   * @param contextBudget - Max tokens
   * @param constraints - SLA and preference constraints
   * @returns A complete query execution plan
   */
  selectOptimalStrategy(
    query: string,
    connectors: ConnectorMeta[],
    contextBudget: number,
    constraints: ExecutionConstraints
  ): Omit<QueryPlan, 'planId' | 'workspaceId' | 'createdAt'> {
    const affinities = this.analyzeQueryConnectorAffinity(query, connectors);
    const relevant = affinities
      .filter((a) => a.relevanceScore > 0 || connectors.length <= 2)
      .map((a) => connectors.find((c) => c.connectorId === a.connectorId)!)
      .filter(Boolean);

    const targetConnectors = relevant.length > 0 ? relevant : connectors;
    const rankings = this.rankExecutionStrategies(
      targetConnectors,
      contextBudget,
      constraints.maxLatencyMs
    );

    let winner = rankings[0];
    if (!winner) {
      winner = {
        strategy: 'parallel',
        score: 0,
        estimatedLatencyP95Ms: 0,
        estimatedTokens: 0,
        estimatedCost: 0,
        pros: [],
        cons: [],
      };
    }

    // Re-rank if cost is priority — downgrade to sequential/cached-first
    if (constraints.preferLowCost) {
      const lowCostOptions = rankings.filter(
        (r) => r.strategy === 'sequential' || r.strategy === 'cached-first'
      );
      if (lowCostOptions.length > 0 && lowCostOptions[0]!.score > winner.score * 0.8) {
        winner = lowCostOptions[0]!;
      }
    }

    // Enforce hard latency constraint
    const withinSla = rankings.filter(
      (r) => r.estimatedLatencyP95Ms <= constraints.maxLatencyMs
    );
    if (withinSla.length > 0 && !withinSla.find((r) => r.strategy === winner!.strategy)) {
      winner = withinSla[0]!;
    }

    const reasoning = buildReasoning(winner, targetConnectors, constraints);

    return {
      query,
      strategy: winner.strategy,
      connectors: targetConnectors.map((c) => c.connectorId),
      estimatedLatencyP95Ms: winner.estimatedLatencyP95Ms,
      estimatedTokens: winner.estimatedTokens,
      estimatedCost: winner.estimatedCost,
      strategyRankings: rankings,
      reasoning,
    };
  }

  /**
   * Persists a query plan to the database.
   * @param workspaceId - Workspace identifier
   * @param planData - Plan without generated fields
   * @returns The saved plan with planId and createdAt
   */
  async recordPlan(
    workspaceId: string,
    planData: Omit<QueryPlan, 'planId' | 'workspaceId' | 'createdAt'>
  ): Promise<QueryPlan> {
    const planId = randomBytes(16).toString('hex');
    const now = new Date();

    try {
      await this.sql`
        INSERT INTO query_execution_plans (
          plan_id, workspace_id, query, strategy, connectors,
          estimated_latency_p95_ms, estimated_tokens, estimated_cost,
          strategy_rankings, reasoning, created_at
        ) VALUES (
          ${planId}, ${workspaceId}, ${planData.query}, ${planData.strategy},
          ${this.sql.array(planData.connectors)},
          ${planData.estimatedLatencyP95Ms}, ${planData.estimatedTokens},
          ${planData.estimatedCost}, ${JSON.stringify(planData.strategyRankings)},
          ${planData.reasoning}, ${now}
        )
      `;

      logger.info('Query execution plan recorded', {
        planId,
        workspaceId,
        strategy: planData.strategy,
        connectorCount: planData.connectors.length,
      });
    } catch (e) {
      logger.error('Failed to persist query execution plan', { planId, error: e });
    }

    return { planId, workspaceId, createdAt: now, ...planData };
  }

  /**
   * Retrieves plan history for a workspace with cursor-based pagination.
   * @param workspaceId - Workspace identifier
   * @param limit - Maximum number of plans to return
   * @param cursor - Opaque pagination cursor (plan_id)
   * @returns Plans and next cursor
   */
  async getPlanHistory(
    workspaceId: string,
    limit: number,
    cursor?: string
  ): Promise<{ plans: QueryPlan[]; nextCursor: string | null }> {
    const rows = cursor
      ? await this.sql<PlanRow[]>`
          SELECT * FROM query_execution_plans
          WHERE workspace_id = ${workspaceId}
            AND plan_id < ${cursor}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `
      : await this.sql<PlanRow[]>`
          SELECT * FROM query_execution_plans
          WHERE workspace_id = ${workspaceId}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `;

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const plans: QueryPlan[] = page.map((r) => ({
      planId: r.plan_id,
      workspaceId: r.workspace_id,
      query: r.query,
      strategy: r.strategy as ExecutionStrategy,
      connectors: r.connectors,
      estimatedLatencyP95Ms: r.estimated_latency_p95_ms,
      estimatedTokens: r.estimated_tokens,
      estimatedCost: r.estimated_cost,
      strategyRankings: r.strategy_rankings,
      reasoning: r.reasoning,
      createdAt: r.created_at,
    }));

    return {
      plans,
      nextCursor: hasMore ? page[page.length - 1]!.plan_id : null,
    };
  }
}

function buildReasoning(
  winner: StrategyScore,
  connectors: ConnectorMeta[],
  constraints: ExecutionConstraints
): string {
  const n = connectors.length;
  const avgCache = connectors.reduce((s, c) => s + c.cacheHitRate, 0) / Math.max(n, 1);
  const parts = [
    `Selected '${winner.strategy}' strategy for ${n} connector(s).`,
    `Estimated p95 latency: ${winner.estimatedLatencyP95Ms}ms (budget: ${constraints.maxLatencyMs}ms).`,
  ];
  if (winner.strategy === 'cached-first') {
    parts.push(`Cache hit rate ~${Math.round(avgCache * 100)}% reduces expected cost.`);
  }
  if (constraints.preferLowCost) {
    parts.push('Low-cost preference applied.');
  }
  parts.push(`Score: ${winner.score.toFixed(3)}.`);
  return parts.join(' ');
}
