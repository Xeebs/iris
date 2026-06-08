import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'llm-cost-optimizer' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type LLMProvider = 'anthropic' | 'openai' | 'azure' | 'gemini';

export type QueryComplexityScore = {
  score: number;
  factors: {
    entityCount: number;
    relationshipDepth: number;
    contextSizeTokens: number;
    requiresReasoning: boolean;
    requiresCodeGeneration: boolean;
  };
};

export type ProviderCostEstimate = {
  provider: LLMProvider;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostCents: number;
  estimatedLatencyMs: number;
};

export type ProviderValueScore = {
  provider: LLMProvider;
  costScore: number;
  speedScore: number;
  accuracyScore: number;
  valueScore: number;
};

export type OptimalProvider = {
  provider: LLMProvider;
  confidence: number;
  estimatedCostCents: number;
  estimatedLatencyMs: number;
  rationale: string;
};

export type ProviderAccuracyBaseline = {
  provider: LLMProvider;
  complexityRange: [number, number];
  accuracyScore: number;
  sampleCount: number;
  measuredAt: Date;
};

export type CostOptimizationStats = {
  totalQueries: number;
  totalCostCents: number;
  avgCostCentsPerQuery: number;
  estimatedSavingsVsDefault: number;
  providerDistribution: Record<LLMProvider, number>;
};

/** Per-1K-token cost in cents for each provider (input/output). */
const PROVIDER_COSTS: Record<LLMProvider, { inputCentsPerKToken: number; outputCentsPerKToken: number; baseLatencyMs: number }> = {
  anthropic: { inputCentsPerKToken: 0.3, outputCentsPerKToken: 1.5, baseLatencyMs: 800 },
  openai: { inputCentsPerKToken: 0.5, outputCentsPerKToken: 1.5, baseLatencyMs: 600 },
  azure: { inputCentsPerKToken: 0.5, outputCentsPerKToken: 1.5, baseLatencyMs: 700 },
  gemini: { inputCentsPerKToken: 0.125, outputCentsPerKToken: 0.375, baseLatencyMs: 500 },
};

/** Default accuracy scores by provider at different complexity tiers (0-3, 4-6, 7-10). */
const DEFAULT_ACCURACY: Record<LLMProvider, [number, number, number]> = {
  anthropic: [0.92, 0.95, 0.98],
  openai: [0.90, 0.93, 0.95],
  azure: [0.90, 0.93, 0.95],
  gemini: [0.88, 0.90, 0.92],
};

function accuracyForProvider(provider: LLMProvider, score: number): number {
  const tier = score <= 3 ? 0 : score <= 6 ? 1 : 2;
  return DEFAULT_ACCURACY[provider][tier];
}

/**
 * Classify a query's complexity on a scale of 1–10.
 * @param query - The query text
 * @param context - Optional context metadata
 * @returns ComplexityScore with breakdown
 */
export function classifyQueryComplexity(
  query: string,
  context: { entityCount?: number; contextTokens?: number; relationshipDepth?: number } = {},
): QueryComplexityScore {
  const lq = query.toLowerCase();

  const entityCount = context.entityCount ?? 1;
  const contextTokens = context.contextTokens ?? 500;
  const relationshipDepth = context.relationshipDepth ?? 1;

  const requiresReasoning = /why|explain|analyze|compare|predict|trend|forecast|insight/.test(lq);
  const requiresCodeGeneration = /code|sql|query|script|function|generate/.test(lq);

  // Score components (each 0-2)
  const entityScore = Math.min(2, entityCount / 5);
  const contextScore = Math.min(2, contextTokens / 1000);
  const depthScore = Math.min(2, relationshipDepth / 3);
  const reasoningScore = requiresReasoning ? 2 : 0;
  const codeScore = requiresCodeGeneration ? 2 : 0;

  const raw = entityScore + contextScore + depthScore + reasoningScore + codeScore;
  const score = Math.min(10, Math.max(1, Math.round(raw)));

  return {
    score,
    factors: { entityCount, relationshipDepth, contextSizeTokens: contextTokens, requiresReasoning, requiresCodeGeneration },
  };
}

/**
 * Estimate token usage and cost for a query across a given provider.
 * @param provider - LLM provider
 * @param query - Query text
 * @param contextTokens - Number of context tokens
 * @param complexity - Pre-computed complexity score
 */
export function estimateTokenUsage(
  provider: LLMProvider,
  query: string,
  contextTokens: number,
  complexity: QueryComplexityScore,
): ProviderCostEstimate {
  const pricing = PROVIDER_COSTS[provider];
  const queryTokens = Math.ceil(query.length / 4);
  const inputTokens = queryTokens + contextTokens;

  // Output tokens scale with complexity
  const baseOutputTokens = 100;
  const outputMultiplier = 1 + (complexity.score - 1) * 0.3;
  const outputTokens = Math.round(baseOutputTokens * outputMultiplier);

  const inputCost = (inputTokens / 1000) * pricing.inputCentsPerKToken;
  const outputCost = (outputTokens / 1000) * pricing.outputCentsPerKToken;
  const totalCost = Math.round((inputCost + outputCost) * 100) / 100;

  const latencyMs = pricing.baseLatencyMs + complexity.score * 50 + inputTokens * 0.01;

  return {
    provider,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCostCents: totalCost,
    estimatedLatencyMs: Math.round(latencyMs),
  };
}

/**
 * Rank providers by cost/speed/accuracy value for a given complexity.
 * @param complexity - Query complexity score
 * @param requirements - Optional constraints (maxCostCents, maxLatencyMs, minAccuracy)
 */
export function rankProvidersByValue(
  complexity: QueryComplexityScore,
  requirements: { maxCostCents?: number; maxLatencyMs?: number; minAccuracy?: number } = {},
): ProviderValueScore[] {
  const providers: LLMProvider[] = ['anthropic', 'openai', 'azure', 'gemini'];
  const estimates = providers.map(p => estimateTokenUsage(p, 'x'.repeat(200), 500, complexity));
  const maxCost = Math.max(...estimates.map(e => e.estimatedCostCents));
  const maxLatency = Math.max(...estimates.map(e => e.estimatedLatencyMs));

  return providers
    .map(p => {
      const est = estimates.find(e => e.provider === p)!;
      const accuracy = accuracyForProvider(p, complexity.score);

      // Filter by constraints
      if (requirements.maxCostCents !== undefined && est.estimatedCostCents > requirements.maxCostCents) {
        return null;
      }
      if (requirements.maxLatencyMs !== undefined && est.estimatedLatencyMs > requirements.maxLatencyMs) {
        return null;
      }
      if (requirements.minAccuracy !== undefined && accuracy < requirements.minAccuracy) {
        return null;
      }

      const costScore = maxCost > 0 ? 1 - est.estimatedCostCents / maxCost : 1;
      const speedScore = maxLatency > 0 ? 1 - est.estimatedLatencyMs / maxLatency : 1;
      const accuracyScore = accuracy;

      // Weighted: accuracy 50%, cost 30%, speed 20%
      const valueScore = accuracyScore * 0.5 + costScore * 0.3 + speedScore * 0.2;

      return {
        provider: p,
        costScore: Math.round(costScore * 100) / 100,
        speedScore: Math.round(speedScore * 100) / 100,
        accuracyScore: Math.round(accuracyScore * 100) / 100,
        valueScore: Math.round(valueScore * 1000) / 1000,
      };
    })
    .filter((r): r is ProviderValueScore => r !== null)
    .sort((a, b) => b.valueScore - a.valueScore);
}

/**
 * Select the optimal LLM provider for a given query and workspace budget.
 * @param query - Query text
 * @param contextTokens - Context size
 * @param workspaceBudget - Optional max spend in cents per query
 * @param requirements - Optional accuracy/latency constraints
 */
export function selectOptimalProvider(
  query: string,
  contextTokens = 500,
  workspaceBudget?: number,
  requirements: { minAccuracy?: number; maxLatencyMs?: number } = {},
): Result<OptimalProvider, Error> {
  try {
    const complexity = classifyQueryComplexity(query, { contextTokens });
    const ranked = rankProvidersByValue(complexity, {
      maxCostCents: workspaceBudget,
      ...requirements,
    });

    if (ranked.length === 0) {
      return err(new Error('No provider meets the specified constraints'));
    }

    const best = ranked[0]!;
    const estimate = estimateTokenUsage(best.provider, query, contextTokens, complexity);

    const rationale = `Selected for highest value score (${(best.valueScore * 100).toFixed(0)}%): `
      + `accuracy ${(best.accuracyScore * 100).toFixed(0)}%, `
      + `cost $${(estimate.estimatedCostCents / 100).toFixed(4)}, `
      + `latency ~${estimate.estimatedLatencyMs}ms`;

    return ok({
      provider: best.provider,
      confidence: best.valueScore,
      estimatedCostCents: estimate.estimatedCostCents,
      estimatedLatencyMs: estimate.estimatedLatencyMs,
      rationale,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Record a query execution's actual cost and accuracy for future optimization.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param queryHash - Hash of the query
 * @param provider - Provider used
 * @param actualTokens - Actual token count from the API response
 * @param actualCostCents - Actual cost charged
 * @param executionTimeMs - Wall-clock execution time
 * @param satisfactionScore - Optional user feedback (0-1)
 */
export async function trackProviderAccuracy(
  sql: SqlFn,
  workspaceId: string,
  queryHash: string,
  provider: LLMProvider,
  actualTokens: number,
  actualCostCents: number,
  executionTimeMs: number,
  satisfactionScore?: number,
): Promise<Result<void, Error>> {
  try {
    await sql`
      INSERT INTO llm_cost_estimates
        (workspace_id, query_hash, provider, actual_tokens, cost_cents, execution_time_ms, user_satisfaction_score)
      VALUES (
        ${workspaceId}, ${queryHash}, ${provider}, ${actualTokens},
        ${actualCostCents}, ${executionTimeMs}, ${satisfactionScore ?? null}
      )
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get aggregated cost optimization statistics for a workspace.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param days - Lookback window
 */
export async function getCostOptimizationStats(
  sql: SqlFn,
  workspaceId: string,
  days = 30,
): Promise<Result<CostOptimizationStats, Error>> {
  try {
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await sql`
      SELECT provider, COUNT(*) AS query_count, SUM(cost_cents) AS total_cost
      FROM llm_cost_estimates
      WHERE workspace_id = ${workspaceId}
        AND created_at >= ${since}
      GROUP BY provider
    ` as unknown as Array<{
      provider: LLMProvider;
      query_count: string;
      total_cost: string;
    }>;

    let totalQueries = 0;
    let totalCostCents = 0;
    const distribution: Record<LLMProvider, number> = { anthropic: 0, openai: 0, azure: 0, gemini: 0 };

    for (const row of rows) {
      const count = parseInt(row.query_count, 10);
      const cost = parseFloat(row.total_cost);
      totalQueries += count;
      totalCostCents += cost;
      if (row.provider in distribution) {
        distribution[row.provider] = count;
      }
    }

    const avgCostCentsPerQuery = totalQueries > 0 ? totalCostCents / totalQueries : 0;

    // Estimate savings vs. always using the most expensive provider (openai at standard rates)
    const openaiRate = PROVIDER_COSTS.openai.inputCentsPerKToken;
    const avgTokens = 1000;
    const defaultCostPerQuery = (avgTokens / 1000) * openaiRate;
    const estimatedSavings = totalQueries * (defaultCostPerQuery - avgCostCentsPerQuery);

    log.info('Cost optimization stats loaded', { workspaceId, totalQueries, totalCostCents });

    return ok({
      totalQueries,
      totalCostCents,
      avgCostCentsPerQuery: Math.round(avgCostCentsPerQuery * 100) / 100,
      estimatedSavingsVsDefault: Math.max(0, Math.round(estimatedSavings * 100) / 100),
      providerDistribution: distribution,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get per-provider accuracy baselines for the dashboard.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 */
export async function getProviderAccuracyBaselines(
  sql: SqlFn,
  workspaceId: string,
): Promise<Result<ProviderAccuracyBaseline[], Error>> {
  try {
    const rows = await sql`
      SELECT provider, AVG(user_satisfaction_score) AS accuracy,
             COUNT(*) AS sample_count, MAX(created_at) AS measured_at
      FROM llm_cost_estimates
      WHERE workspace_id = ${workspaceId}
        AND user_satisfaction_score IS NOT NULL
      GROUP BY provider
    ` as unknown as Array<{
      provider: LLMProvider;
      accuracy: string | null;
      sample_count: string;
      measured_at: string;
    }>;

    const baselines: ProviderAccuracyBaseline[] = rows.map(r => ({
      provider: r.provider,
      complexityRange: [1, 10] as [number, number],
      accuracyScore: parseFloat(r.accuracy ?? '0'),
      sampleCount: parseInt(r.sample_count, 10),
      measuredAt: new Date(r.measured_at),
    }));

    return ok(baselines);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
