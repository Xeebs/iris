import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  analyzeQueryStructure,
  estimateDeltaTokens,
  estimateContextTokens,
  computeCostCents,
  rankOptimizations,
  predictCacheSavings,
  QueryCostEstimator,
} from '../query-cost-estimator.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

// ─── analyzeQueryStructure ────────────────────────────────────────────────────

describe('analyzeQueryStructure', () => {
  it('classifies trend queries as analytical', () => {
    const f = analyzeQueryStructure('show me revenue trend over time by region');
    expect(f.queryType).toBe('analytical');
  });

  it('classifies count queries as reporting', () => {
    const f = analyzeQueryStructure('total count of deals closed this quarter');
    expect(f.queryType).toBe('reporting');
  });

  it('classifies "show me" queries as operational', () => {
    const f = analyzeQueryStructure('show me contacts in the SaaS industry');
    expect(f.queryType).toBe('operational');
  });

  it('extracts entity type count', () => {
    const f = analyzeQueryStructure('contacts with their company and associated deals');
    expect(f.entityTypeCount).toBeGreaterThanOrEqual(3);
  });

  it('detects filter depth from keywords', () => {
    const f = analyzeQueryStructure('contacts where stage = customer and industry = SaaS and region = north');
    expect(f.filterDepth).toBeGreaterThan(0);
  });

  it('detects relationship traversals', () => {
    const f = analyzeQueryStructure('contacts and their related companies');
    expect(f.relationshipTraversals).toBeGreaterThan(0);
  });

  it('detects chained queries', () => {
    const f = analyzeQueryStructure('find SaaS contacts and then show their deals');
    expect(f.hasChainedQuery).toBe(true);
  });

  it('detects aggregation', () => {
    const f = analyzeQueryStructure('group by stage and count contacts');
    expect(f.hasAggregation).toBe(true);
  });

  it('sets larger context size for full queries', () => {
    const brief = analyzeQueryStructure('give me a brief summary');
    const full = analyzeQueryStructure('show me full detailed attributes');
    expect(full.requestedContextSize).toBeGreaterThan(brief.requestedContextSize);
  });
});

// ─── estimateDeltaTokens ──────────────────────────────────────────────────────

describe('estimateDeltaTokens', () => {
  it('returns positive token count', () => {
    const features = analyzeQueryStructure('show me contacts');
    const tokens = estimateDeltaTokens('show me contacts', features, 'gpt-4o-mini');
    expect(tokens).toBeGreaterThan(0);
  });

  it('mini/haiku models produce fewer tokens than large models', () => {
    const features = analyzeQueryStructure('show me SaaS contacts with deals');
    const miniTokens = estimateDeltaTokens('show me SaaS contacts with deals', features, 'gpt-4o-mini');
    const fullTokens = estimateDeltaTokens('show me SaaS contacts with deals', features, 'gpt-4o');
    expect(miniTokens).toBeLessThan(fullTokens);
  });

  it('complex queries with chaining cost more delta tokens', () => {
    const simple = analyzeQueryStructure('show me contacts');
    const complex = analyzeQueryStructure('contacts where stage = customer and then their deals');
    const simpleTokens = estimateDeltaTokens('show me contacts', simple, 'gpt-4o');
    const complexTokens = estimateDeltaTokens('contacts where stage = customer and then their deals', complex, 'gpt-4o');
    expect(complexTokens).toBeGreaterThan(simpleTokens);
  });
});

// ─── estimateContextTokens ────────────────────────────────────────────────────

describe('estimateContextTokens', () => {
  it('returns positive token count', () => {
    const features = analyzeQueryStructure('list contacts');
    const tokens = estimateContextTokens(10, 'json', features);
    expect(tokens).toBeGreaterThan(0);
  });

  it('prose format costs more than bullets format', () => {
    const features = analyzeQueryStructure('list contacts');
    const proseTokens = estimateContextTokens(20, 'prose', features);
    const bulletTokens = estimateContextTokens(20, 'bullets', features);
    expect(proseTokens).toBeGreaterThan(bulletTokens);
  });

  it('more entities → more tokens (up to context budget cap)', () => {
    const features = analyzeQueryStructure('show me contacts');
    const fewTokens = estimateContextTokens(5, 'json', features);
    const manyTokens = estimateContextTokens(50, 'json', features);
    expect(manyTokens).toBeGreaterThan(fewTokens);
  });
});

// ─── computeCostCents ─────────────────────────────────────────────────────────

describe('computeCostCents', () => {
  it('returns positive cost for non-zero tokens', () => {
    expect(computeCostCents(100, 200, 'gpt-4o')).toBeGreaterThan(0);
  });

  it('mini model is cheaper than full model', () => {
    const miniCost = computeCostCents(200, 800, 'gpt-4o-mini');
    const fullCost = computeCostCents(200, 800, 'gpt-4o');
    expect(miniCost).toBeLessThan(fullCost);
  });

  it('returns zero for zero tokens', () => {
    expect(computeCostCents(0, 0, 'claude-3-haiku')).toBe(0);
  });

  it('output tokens cost more than input tokens for same count', () => {
    const inputOnly = computeCostCents(1000, 0, 'gpt-4o');
    const outputOnly = computeCostCents(0, 1000, 'gpt-4o');
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });
});

// ─── rankOptimizations ────────────────────────────────────────────────────────

describe('rankOptimizations', () => {
  it('returns up to 5 suggestions', () => {
    const features = analyzeQueryStructure('contacts where stage = customer and industry = SaaS and region = north then their deals');
    const suggestions = rankOptimizations(features, 2000);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });

  it('suggestions are sorted by savings descending', () => {
    const features = analyzeQueryStructure('contacts where stage = customer and industry = SaaS and region = north and then their deals total count');
    const suggestions = rankOptimizations(features, 2000);
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1]!.estimatedSavingsPct).toBeGreaterThanOrEqual(suggestions[i]!.estimatedSavingsPct);
    }
  });

  it('recommends increase-cache-ttl for large context', () => {
    const features = analyzeQueryStructure('show me contacts');
    const suggestions = rankOptimizations(features, 2000);
    const cacheOpt = suggestions.find((s) => s.id === 'increase-cache-ttl');
    expect(cacheOpt).toBeDefined();
  });

  it('recommends filter-earlier for deep filter depth', () => {
    const features = analyzeQueryStructure('contacts where stage = customer and industry = SaaS and region = north and arr > 100k');
    const suggestions = rankOptimizations(features, 800);
    const filterOpt = suggestions.find((s) => s.id === 'filter-earlier');
    expect(filterOpt).toBeDefined();
  });

  it('recommends summarization for reporting queries with aggregation', () => {
    const features = analyzeQueryStructure('total count of deals grouped by stage');
    const suggestions = rankOptimizations(features, 800);
    const sumOpt = suggestions.find((s) => s.id === 'use-summarization');
    expect(sumOpt).toBeDefined();
  });
});

// ─── predictCacheSavings ──────────────────────────────────────────────────────

describe('predictCacheSavings', () => {
  it('returns valid prediction shape', () => {
    const pred = predictCacheSavings('hash-abc', 120, 800, 'gpt-4o-mini', 0.4);
    expect(pred.queryHash).toBe('hash-abc');
    expect(pred.cacheHitProbability).toBe(0.4);
    expect(pred.estimatedSavedTokens).toBeGreaterThan(0);
    expect(pred.estimatedSavedCostCents).toBeGreaterThanOrEqual(0);
  });

  it('recommends caching when hit rate > 15% and context > 500 tokens', () => {
    const pred = predictCacheSavings('hash-xyz', 100, 800, 'gpt-4o', 0.3);
    expect(pred.recommendCaching).toBe(true);
  });

  it('does not recommend caching for tiny context', () => {
    const pred = predictCacheSavings('hash-tiny', 50, 200, 'gpt-4o', 0.5);
    expect(pred.recommendCaching).toBe(false);
  });

  it('zero hit rate means zero saved tokens', () => {
    const pred = predictCacheSavings('hash-zero', 100, 800, 'gpt-4o-mini', 0);
    expect(pred.estimatedSavedTokens).toBe(0);
  });
});

// ─── QueryCostEstimator class ─────────────────────────────────────────────────

describe('QueryCostEstimator', () => {
  let sql: ReturnType<typeof vi.fn>;
  let estimator: QueryCostEstimator;

  beforeEach(() => {
    sql = vi.fn().mockResolvedValue([]);
    estimator = new QueryCostEstimator(sql as never);
    vi.clearAllMocks();
    sql.mockResolvedValue([]);
  });

  describe('estimateQueryCost', () => {
    it('returns a cost estimate and persists it', async () => {
      const result = await estimator.estimateQueryCost(
        'abc123',
        'show me SaaS contacts with high ARR',
        'gpt-4o-mini',
        20,
        'json',
      );

      expect(result.isOk()).toBe(true);
      expect(result.value.queryHash).toBe('abc123');
      expect(result.value.provider).toBe('gpt-4o-mini');
      expect(result.value.estimatedDeltaTokens).toBeGreaterThan(0);
      expect(result.value.estimatedContextTokens).toBeGreaterThan(0);
      expect(result.value.totalEstimatedCostCents).toBeGreaterThanOrEqual(0);
      expect(result.value.optimizationSuggestions.length).toBeGreaterThanOrEqual(0);
      expect(sql).toHaveBeenCalled();
    });

    it('returns err on database failure', async () => {
      sql.mockRejectedValue(new Error('insert failed'));
      const result = await estimator.estimateQueryCost('hash-fail', 'contacts', 'claude-3-haiku', 10);
      expect(result.isErr()).toBe(true);
    });

    it('analytical queries produce higher estimates than operational', async () => {
      const [analyticalResult, operationalResult] = await Promise.all([
        estimator.estimateQueryCost('h1', 'show revenue trend over time forecast by region', 'gpt-4o', 50),
        estimator.estimateQueryCost('h2', 'list contacts', 'gpt-4o', 5),
      ]);

      expect(analyticalResult.isOk() && operationalResult.isOk()).toBe(true);
      const analytical = analyticalResult.value;
      const operational = operationalResult.value;
      expect(analytical.estimatedContextTokens).toBeGreaterThan(operational.estimatedContextTokens);
    });
  });

  describe('getCostHistory', () => {
    it('returns history entries and pagination state', async () => {
      sql.mockResolvedValue([
        { query_hash: 'h1', provider: 'gpt-4o-mini', estimated_delta_tokens: 100, estimated_context_tokens: 400, total_estimated_cost_cents: 0.02, created_at: new Date().toISOString(), actual_tokens: 480 },
      ]);

      const result = await estimator.getCostHistory('ws1', 50);
      expect(result.isOk()).toBe(true);
      expect(result.value.entries).toHaveLength(1);
      expect(result.value.entries[0]!.queryHash).toBe('h1');
      expect(result.value.hasMore).toBe(false);
    });

    it('sets hasMore=true when row count exceeds limit', async () => {
      const rows = Array.from({ length: 6 }, (_, i) => ({
        query_hash: `h${i}`,
        provider: 'gpt-4o-mini',
        estimated_delta_tokens: 100,
        estimated_context_tokens: 400,
        total_estimated_cost_cents: 0.02,
        created_at: new Date().toISOString(),
        actual_tokens: null,
      }));
      sql.mockResolvedValue(rows);

      const result = await estimator.getCostHistory('ws1', 5);
      expect(result.isOk()).toBe(true);
      expect(result.value.hasMore).toBe(true);
      expect(result.value.entries).toHaveLength(5);
    });

    it('returns err on database failure', async () => {
      sql.mockRejectedValue(new Error('query failed'));
      const result = await estimator.getCostHistory('ws1');
      expect(result.isErr()).toBe(true);
    });
  });
});
