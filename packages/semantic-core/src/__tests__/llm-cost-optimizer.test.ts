import { describe, it, expect, vi } from 'vitest';
import {
  classifyQueryComplexity,
  estimateTokenUsage,
  rankProvidersByValue,
  selectOptimalProvider,
  trackProviderAccuracy,
  getCostOptimizationStats,
} from '../llm-cost-optimizer';

describe('classifyQueryComplexity', () => {
  it('assigns low score to simple short query', () => {
    const result = classifyQueryComplexity('show contacts', { entityCount: 1, contextTokens: 100 });
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(4);
    expect(result.factors.requiresReasoning).toBe(false);
    expect(result.factors.requiresCodeGeneration).toBe(false);
  });

  it('assigns high score to complex analytical query', () => {
    const result = classifyQueryComplexity(
      'analyze and explain the trend in deals pipeline and forecast next quarter revenue',
      { entityCount: 50, contextTokens: 2000, relationshipDepth: 5 },
    );
    expect(result.score).toBeGreaterThanOrEqual(7);
    expect(result.factors.requiresReasoning).toBe(true);
  });

  it('detects code generation intent', () => {
    const result = classifyQueryComplexity('generate sql query for contacts table', { contextTokens: 200 });
    expect(result.factors.requiresCodeGeneration).toBe(true);
  });

  it('scores minimum 1 for trivial inputs', () => {
    const result = classifyQueryComplexity('hi', {});
    expect(result.score).toBe(1);
  });

  it('scores maximum 10 for extreme inputs', () => {
    const result = classifyQueryComplexity(
      'analyze explain predict generate sql code',
      { entityCount: 500, contextTokens: 100000, relationshipDepth: 50 },
    );
    expect(result.score).toBe(10);
  });

  it('uses defaults when context is omitted', () => {
    const result = classifyQueryComplexity('list contacts');
    expect(result.factors.entityCount).toBe(1);
    expect(result.factors.contextSizeTokens).toBe(500);
    expect(result.factors.relationshipDepth).toBe(1);
  });
});

describe('estimateTokenUsage', () => {
  const complexity = classifyQueryComplexity('show me contacts', { contextTokens: 500 });

  it('returns a valid estimate for each provider', () => {
    for (const provider of ['anthropic', 'openai', 'azure', 'gemini'] as const) {
      const est = estimateTokenUsage(provider, 'show me contacts', 500, complexity);
      expect(est.provider).toBe(provider);
      expect(est.estimatedInputTokens).toBeGreaterThan(0);
      expect(est.estimatedOutputTokens).toBeGreaterThan(0);
      expect(est.estimatedCostCents).toBeGreaterThanOrEqual(0);
      expect(est.estimatedLatencyMs).toBeGreaterThan(0);
    }
  });

  it('gemini is cheaper than openai for same query', () => {
    const openai = estimateTokenUsage('openai', 'analyze my data', 500, complexity);
    const gemini = estimateTokenUsage('gemini', 'analyze my data', 500, complexity);
    expect(gemini.estimatedCostCents).toBeLessThan(openai.estimatedCostCents);
  });

  it('output tokens scale with complexity', () => {
    const low = classifyQueryComplexity('hi');
    const high = classifyQueryComplexity('analyze explain predict forecast insight', { contextTokens: 2000 });
    const lowEst = estimateTokenUsage('anthropic', 'hi', 100, low);
    const highEst = estimateTokenUsage('anthropic', 'analyze explain predict', 2000, high);
    expect(highEst.estimatedOutputTokens).toBeGreaterThan(lowEst.estimatedOutputTokens);
  });

  it('input tokens include query and context', () => {
    const query = 'get deals';
    const contextTokens = 300;
    const est = estimateTokenUsage('openai', query, contextTokens, complexity);
    const queryTokens = Math.ceil(query.length / 4);
    expect(est.estimatedInputTokens).toBe(queryTokens + contextTokens);
  });
});

describe('rankProvidersByValue', () => {
  const complexity = classifyQueryComplexity('show me contacts', { contextTokens: 500 });

  it('returns all 4 providers when no constraints', () => {
    const ranked = rankProvidersByValue(complexity);
    expect(ranked).toHaveLength(4);
    const providers = ranked.map(r => r.provider);
    expect(providers).toContain('anthropic');
    expect(providers).toContain('gemini');
  });

  it('ranks best value first', () => {
    const ranked = rankProvidersByValue(complexity);
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i]!.valueScore).toBeGreaterThanOrEqual(ranked[i + 1]!.valueScore);
    }
  });

  it('filters providers exceeding maxCostCents', () => {
    const ranked = rankProvidersByValue(complexity, { maxCostCents: 0.001 });
    for (const r of ranked) {
      const est = estimateTokenUsage(r.provider, 'x'.repeat(200), 500, complexity);
      expect(est.estimatedCostCents).toBeLessThanOrEqual(0.001);
    }
  });

  it('returns empty array when constraints eliminate all providers', () => {
    const ranked = rankProvidersByValue(complexity, { maxCostCents: 0, maxLatencyMs: 0 });
    expect(ranked).toHaveLength(0);
  });

  it('value score is between 0 and 1', () => {
    const ranked = rankProvidersByValue(complexity);
    for (const r of ranked) {
      expect(r.valueScore).toBeGreaterThanOrEqual(0);
      expect(r.valueScore).toBeLessThanOrEqual(1);
    }
  });
});

describe('selectOptimalProvider', () => {
  it('returns an Ok result with a valid provider', () => {
    const result = selectOptimalProvider('show me top deals');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(['anthropic', 'openai', 'azure', 'gemini']).toContain(result.value.provider);
      expect(result.value.confidence).toBeGreaterThan(0);
      expect(result.value.rationale).toBeTruthy();
    }
  });

  it('returns Err when budget is zero', () => {
    const result = selectOptimalProvider('analyze trends', 500, 0);
    expect(result.isErr()).toBe(true);
  });

  it('respects minAccuracy constraint', () => {
    // Complex query (score >= 4) to push anthropic into tier-1 accuracy (0.95)
    const result = selectOptimalProvider(
      'explain and analyze the trend in deals for multiple accounts',
      2000,
      undefined,
      { minAccuracy: 0.95 },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(['anthropic', 'openai'].some(p => p === result.value.provider)).toBe(true);
    }
  });

  it('includes cost and latency in result', () => {
    const result = selectOptimalProvider('get metrics');
    if (result.isOk()) {
      expect(result.value.estimatedCostCents).toBeGreaterThanOrEqual(0);
      expect(result.value.estimatedLatencyMs).toBeGreaterThan(0);
    }
  });
});

describe('trackProviderAccuracy', () => {
  it('inserts a row and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await trackProviderAccuracy(sql as unknown as Parameters<typeof trackProviderAccuracy>[0], 'ws1', 'hash123', 'anthropic', 1200, 0.5, 950, 0.9);
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledOnce();
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('DB down'));
    const result = await trackProviderAccuracy(sql as unknown as Parameters<typeof trackProviderAccuracy>[0], 'ws1', 'hash123', 'openai', 1000, 0.4, 700);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('DB down');
  });

  it('works without satisfactionScore', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await trackProviderAccuracy(sql as unknown as Parameters<typeof trackProviderAccuracy>[0], 'ws2', 'hash456', 'gemini', 500, 0.05, 450);
    expect(result.isOk()).toBe(true);
  });
});

describe('getCostOptimizationStats', () => {
  it('returns aggregated stats', async () => {
    const sql = vi.fn().mockResolvedValue([
      { provider: 'anthropic', query_count: '10', total_cost: '5.0' },
      { provider: 'gemini', query_count: '20', total_cost: '2.0' },
    ]);
    const result = await getCostOptimizationStats(sql as unknown as Parameters<typeof getCostOptimizationStats>[0], 'ws1', 30);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.totalQueries).toBe(30);
      expect(result.value.totalCostCents).toBe(7);
      expect(result.value.providerDistribution.anthropic).toBe(10);
      expect(result.value.providerDistribution.gemini).toBe(20);
    }
  });

  it('returns zeros for empty workspace', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await getCostOptimizationStats(sql as unknown as Parameters<typeof getCostOptimizationStats>[0], 'new-ws', 30);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.totalQueries).toBe(0);
      expect(result.value.avgCostCentsPerQuery).toBe(0);
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await getCostOptimizationStats(sql as unknown as Parameters<typeof getCostOptimizationStats>[0], 'ws1');
    expect(result.isErr()).toBe(true);
  });

  it('estimatedSavingsVsDefault is never negative', async () => {
    const sql = vi.fn().mockResolvedValue([
      { provider: 'openai', query_count: '5', total_cost: '100.0' },
    ]);
    const result = await getCostOptimizationStats(sql as unknown as Parameters<typeof getCostOptimizationStats>[0], 'ws1', 7);
    if (result.isOk()) {
      expect(result.value.estimatedSavingsVsDefault).toBeGreaterThanOrEqual(0);
    }
  });
});
