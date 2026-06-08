import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-cost-estimator' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueryType = 'analytical' | 'operational' | 'reporting' | 'synthesis';

export type OutputFormat = 'json' | 'prose' | 'table' | 'bullets';

export type Provider = 'gpt-4o' | 'gpt-4o-mini' | 'claude-3-5-sonnet' | 'claude-3-haiku';

export type QueryComplexityFeatures = {
  queryType: QueryType;
  entityTypeCount: number;
  filterDepth: number;
  relationshipTraversals: number;
  requestedContextSize: number;
  hasAggregation: boolean;
  hasChainedQuery: boolean;
};

export type CostEstimate = {
  queryHash: string;
  provider: Provider;
  estimatedDeltaTokens: number;
  estimatedContextTokens: number;
  totalEstimatedCostCents: number;
  optimizationSuggestions: OptimizationSuggestion[];
  createdAt: Date;
};

export type OptimizationSuggestion = {
  id: string;
  description: string;
  estimatedSavingsPct: number;
  effort: 'low' | 'medium' | 'high';
};

export type CacheSavingsPrediction = {
  queryHash: string;
  cacheHitProbability: number;
  estimatedSavedTokens: number;
  estimatedSavedCostCents: number;
  recommendCaching: boolean;
};

// ─── Provider pricing (cost per 1000 tokens in cents) ────────────────────────

const PROVIDER_PRICING: Record<Provider, { input: number; output: number }> = {
  'gpt-4o': { input: 0.5, output: 1.5 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  'claude-3-5-sonnet': { input: 0.3, output: 1.5 },
  'claude-3-haiku': { input: 0.025, output: 0.125 },
};

// ─── Base token estimates by query type ──────────────────────────────────────

const BASE_TOKENS_BY_TYPE: Record<QueryType, { delta: number; context: number }> = {
  analytical: { delta: 150, context: 800 },
  operational: { delta: 80, context: 400 },
  reporting: { delta: 200, context: 1200 },
  synthesis: { delta: 120, context: 600 },
};

// ─── Token multipliers per format ────────────────────────────────────────────

const FORMAT_MULTIPLIER: Record<OutputFormat, number> = {
  json: 1.0,
  prose: 1.4,
  table: 1.2,
  bullets: 0.9,
};

// ─── Pure functions ───────────────────────────────────────────────────────────

/**
 * Extract complexity features from a natural language query string.
 *
 * @param query - Natural language query
 */
export function analyzeQueryStructure(query: string): QueryComplexityFeatures {
  const lower = query.toLowerCase();

  const queryType: QueryType =
    lower.includes('trend') || lower.includes('over time') || lower.includes('compare') || lower.includes('forecast')
      ? 'analytical'
      : lower.includes('total') || lower.includes('sum') || lower.includes('count') || lower.includes('report')
        ? 'reporting'
        : lower.includes('show me') || lower.includes('list') || lower.includes('find')
          ? 'operational'
          : 'synthesis';

  const entityTypeCount = (lower.match(/\b(contacts?|compan(?:y|ies)|deals?|accounts?|tickets?|opportunit(?:y|ies)|leads?|campaigns?)\b/g) ?? []).length || 1;

  const filterDepth =
    (lower.match(/\bwhere\b|\bwith\b|\bwhen\b|\band\b|\bor\b/g) ?? []).length;

  const relationshipTraversals =
    (lower.match(/\btheir\b|\brelated\b|\bassociated\b|\bowned by\b|\bbelongs to\b/g) ?? []).length;

  const requestedContextSize =
    lower.includes('full') || lower.includes('detailed') || lower.includes('all')
      ? 3000
      : lower.includes('summary') || lower.includes('brief')
        ? 500
        : 2000;

  const hasAggregation =
    lower.includes('total') || lower.includes('sum') || lower.includes('average') ||
    lower.includes('count') || lower.includes('group by') || lower.includes('max') || lower.includes('min');

  const hasChainedQuery = lower.includes('then') || lower.includes('followed by') || lower.includes('and then');

  return {
    queryType,
    entityTypeCount,
    filterDepth,
    relationshipTraversals,
    requestedContextSize,
    hasAggregation,
    hasChainedQuery,
  };
}

/**
 * Estimate delta tokens (query embedding + compression overhead) for a provider.
 *
 * @param query - Natural language query
 * @param features - Pre-extracted complexity features
 * @param provider - Target LLM provider
 */
export function estimateDeltaTokens(
  query: string,
  features: QueryComplexityFeatures,
  provider: Provider,
): number {
  const base = BASE_TOKENS_BY_TYPE[features.queryType].delta;
  const queryTokens = Math.ceil(query.length / 4);

  const complexityMultiplier =
    1 +
    (features.filterDepth * 0.05) +
    (features.relationshipTraversals * 0.1) +
    (features.hasChainedQuery ? 0.3 : 0) +
    (features.hasAggregation ? 0.1 : 0);

  const providerFactor = provider === 'gpt-4o-mini' || provider === 'claude-3-haiku' ? 0.8 : 1.0;

  return Math.round((base + queryTokens) * complexityMultiplier * providerFactor);
}

/**
 * Estimate context tokens delivered to the LLM.
 *
 * @param entityCount - Number of entities in context
 * @param format - Output serialization format
 * @param features - Query complexity features
 */
export function estimateContextTokens(
  entityCount: number,
  format: OutputFormat,
  features: QueryComplexityFeatures,
): number {
  const base = BASE_TOKENS_BY_TYPE[features.queryType].context;
  const tokensPerEntity = format === 'json' ? 80 : format === 'prose' ? 60 : 70;
  const entityContribution = entityCount * tokensPerEntity;
  const formatMult = FORMAT_MULTIPLIER[format];
  const cappedContext = Math.min(features.requestedContextSize, base + entityContribution);
  return Math.round(cappedContext * formatMult);
}

/**
 * Compute total cost in cents for a query given provider pricing.
 *
 * @param deltaTokens - Input (delta) token estimate
 * @param contextTokens - Output (context) token estimate
 * @param provider - Provider to price against
 */
export function computeCostCents(
  deltaTokens: number,
  contextTokens: number,
  provider: Provider,
): number {
  const pricing = PROVIDER_PRICING[provider];
  const inputCost = (deltaTokens / 1000) * pricing.input;
  const outputCost = (contextTokens / 1000) * pricing.output;
  return Math.round((inputCost + outputCost) * 100) / 100;
}

/**
 * Generate 3-5 optimization suggestions sorted by estimated savings.
 *
 * @param features - Query complexity features
 * @param contextTokens - Estimated context size
 */
export function rankOptimizations(
  features: QueryComplexityFeatures,
  contextTokens: number,
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  if (features.filterDepth > 3) {
    suggestions.push({
      id: 'filter-earlier',
      description: 'Apply entity type filters before semantic search to reduce retrieval scope',
      estimatedSavingsPct: 25,
      effort: 'low',
    });
  }

  if (features.relationshipTraversals > 1) {
    suggestions.push({
      id: 'reduce-depth',
      description: 'Reduce relationship traversal depth from full graph to 1-hop expansion',
      estimatedSavingsPct: 20,
      effort: 'low',
    });
  }

  if (contextTokens > 1500) {
    suggestions.push({
      id: 'increase-cache-ttl',
      description: 'Increase cache TTL for this query pattern to 30 minutes to amortize context cost',
      estimatedSavingsPct: 40,
      effort: 'medium',
    });
  }

  if (features.queryType === 'reporting' || features.hasAggregation) {
    suggestions.push({
      id: 'use-summarization',
      description: 'Enable context summarization mode to compress entity list into key metrics',
      estimatedSavingsPct: 35,
      effort: 'low',
    });
  }

  if (contextTokens > 1000) {
    suggestions.push({
      id: 'change-format',
      description: 'Switch serialization from JSON to bullets format to reduce output tokens by ~10%',
      estimatedSavingsPct: 10,
      effort: 'low',
    });
  }

  if (features.hasChainedQuery) {
    suggestions.push({
      id: 'cache-intermediate',
      description: 'Cache first-step result to avoid re-embedding on chained query re-runs',
      estimatedSavingsPct: 15,
      effort: 'medium',
    });
  }

  return suggestions.sort((a, b) => b.estimatedSavingsPct - a.estimatedSavingsPct).slice(0, 5);
}

/**
 * Predict cache savings for a repeated query.
 *
 * @param queryHash - SHA-256 hash of the query string
 * @param deltaTokens - Estimated delta tokens for a cache miss
 * @param contextTokens - Estimated context tokens for a cache miss
 * @param provider - Provider pricing to compute savings
 * @param historicalHitRate - Historical cache hit rate for similar queries (0–1)
 */
export function predictCacheSavings(
  queryHash: string,
  deltaTokens: number,
  contextTokens: number,
  provider: Provider,
  historicalHitRate = 0.3,
): CacheSavingsPrediction {
  const fullCostCents = computeCostCents(deltaTokens, contextTokens, provider);
  // On a cache hit: only pay for the delta tokens (query embedding), not context delivery
  const cacheMissCostCents = computeCostCents(deltaTokens, 0, provider);
  const savedCostCents = fullCostCents - cacheMissCostCents;

  return {
    queryHash,
    cacheHitProbability: historicalHitRate,
    estimatedSavedTokens: Math.round(contextTokens * historicalHitRate),
    estimatedSavedCostCents: Math.round(savedCostCents * historicalHitRate * 1000) / 1000,
    recommendCaching: historicalHitRate > 0.15 && contextTokens > 500,
  };
}

// ─── QueryCostEstimator class ─────────────────────────────────────────────────

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export class QueryCostEstimator {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Estimate cost for a hypothetical query and persist the estimate.
   *
   * @param queryHash - SHA-256 hash of the query
   * @param query - Natural language query string
   * @param provider - Target LLM provider
   * @param entityCount - Expected entity count in context
   * @param format - Output serialization format
   */
  async estimateQueryCost(
    queryHash: string,
    query: string,
    provider: Provider,
    entityCount: number,
    format: OutputFormat = 'json',
  ): Promise<Result<CostEstimate, Error>> {
    try {
      const features = analyzeQueryStructure(query);
      const deltaTokens = estimateDeltaTokens(query, features, provider);
      const contextTokens = estimateContextTokens(entityCount, format, features);
      const costCents = computeCostCents(deltaTokens, contextTokens, provider);
      const optimizationSuggestions = rankOptimizations(features, contextTokens);

      const suggestionsJson = JSON.stringify(optimizationSuggestions);

      await this.sql`
        INSERT INTO query_cost_estimates
          (query_hash, provider, estimated_delta_tokens, estimated_context_tokens, total_estimated_cost_cents, optimization_suggestions)
        VALUES
          (${queryHash}, ${provider}, ${deltaTokens}, ${contextTokens}, ${costCents}, ${suggestionsJson}::jsonb)
        ON CONFLICT (query_hash, provider) DO UPDATE SET
          estimated_delta_tokens = EXCLUDED.estimated_delta_tokens,
          estimated_context_tokens = EXCLUDED.estimated_context_tokens,
          total_estimated_cost_cents = EXCLUDED.total_estimated_cost_cents,
          optimization_suggestions = EXCLUDED.optimization_suggestions,
          created_at = NOW()
      `;

      log.info('Cost estimate persisted', { queryHash, provider, deltaTokens, contextTokens, costCents });

      return ok({
        queryHash,
        provider,
        estimatedDeltaTokens: deltaTokens,
        estimatedContextTokens: contextTokens,
        totalEstimatedCostCents: costCents,
        optimizationSuggestions,
        createdAt: new Date(),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve cost history for a workspace — actual vs. estimated cost comparison.
   *
   * @param workspaceId - Workspace to query
   * @param limit - Maximum entries to return
   * @param cursor - Pagination cursor (ISO timestamp)
   */
  async getCostHistory(
    workspaceId: string,
    limit = 50,
    cursor?: string,
  ): Promise<Result<{ entries: CostHistoryEntry[]; nextCursor: string | null; hasMore: boolean }, Error>> {
    try {
      let rows: CostHistoryRow[];
      if (cursor) {
        rows = await this.sql`
          SELECT
            qce.query_hash,
            qce.provider,
            qce.estimated_delta_tokens,
            qce.estimated_context_tokens,
            qce.total_estimated_cost_cents,
            qce.created_at,
            al.token_estimate AS actual_tokens
          FROM query_cost_estimates qce
          LEFT JOIN mcp_audit_log al ON al.query_hash = qce.query_hash
          WHERE al.workspace_id = ${workspaceId}
            AND qce.created_at < ${cursor}::timestamptz
          ORDER BY qce.created_at DESC
          LIMIT ${limit + 1}
        ` as CostHistoryRow[];
      } else {
        rows = await this.sql`
          SELECT
            qce.query_hash,
            qce.provider,
            qce.estimated_delta_tokens,
            qce.estimated_context_tokens,
            qce.total_estimated_cost_cents,
            qce.created_at,
            al.token_estimate AS actual_tokens
          FROM query_cost_estimates qce
          LEFT JOIN mcp_audit_log al ON al.query_hash = qce.query_hash
          WHERE al.workspace_id = ${workspaceId}
          ORDER BY qce.created_at DESC
          LIMIT ${limit + 1}
        ` as CostHistoryRow[];
      }

      const hasMore = rows.length > limit;
      const entries = rows.slice(0, limit).map((r) => ({
        queryHash: r.query_hash,
        provider: r.provider as Provider,
        estimatedTokens: r.estimated_delta_tokens + r.estimated_context_tokens,
        actualTokens: r.actual_tokens ?? null,
        estimatedCostCents: r.total_estimated_cost_cents,
        createdAt: new Date(r.created_at),
      }));

      const nextCursor = hasMore ? rows[limit - 1]!.created_at : null;

      return ok({ entries, nextCursor, hasMore });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

type CostHistoryRow = {
  query_hash: string;
  provider: string;
  estimated_delta_tokens: number;
  estimated_context_tokens: number;
  total_estimated_cost_cents: number;
  created_at: string;
  actual_tokens: number | null;
};

export type CostHistoryEntry = {
  queryHash: string;
  provider: Provider;
  estimatedTokens: number;
  actualTokens: number | null;
  estimatedCostCents: number;
  createdAt: Date;
};
