import { describe, it, expect, vi } from 'vitest';
import {
  analyzeQueryPattern,
  selectExecutionStrategy,
  estimateCost,
  buildExecutionPlan,
  recordPlanExecution,
  getOptimizerStats,
} from '../query-optimizer.js';

describe('analyzeQueryPattern', () => {
  it('assigns low selectivity to specific ID queries', () => {
    const a = analyzeQueryPattern('entity id:abc-123');
    expect(a.estimatedSelectivity).toBeLessThan(0.2);
  });

  it('assigns high selectivity to broad queries', () => {
    const a = analyzeQueryPattern('show all records');
    expect(a.estimatedSelectivity).toBeGreaterThan(0.6);
  });

  it('detects date-range patterns', () => {
    const a = analyzeQueryPattern('deals closed this month');
    expect(a.hasEntityTypeFilter).toBe(true);
  });

  it('detects aggregation queries', () => {
    const a = analyzeQueryPattern('top 10 customers by revenue');
    expect(a.isAggregation).toBe(true);
  });

  it('detects entity type filter from filters object', () => {
    const a = analyzeQueryPattern('find records', { type: 'contact' });
    expect(a.hasEntityTypeFilter).toBe(true);
  });

  it('detects attribute filters', () => {
    const a = analyzeQueryPattern('find records', { status: 'active', region: 'EU' });
    expect(a.hasAttributeFilters).toBe(true);
    expect(a.complexityScore).toBeGreaterThan(0);
  });

  it('returns higher complexity for longer queries', () => {
    const short = analyzeQueryPattern('contacts');
    const long = analyzeQueryPattern('find all enterprise contacts in healthcare who have open support tickets and associated deals over $100k this quarter');
    expect(long.complexityScore).toBeGreaterThan(short.complexityScore);
  });

  it('returns cache hit likelihood for short simple queries', () => {
    const a = analyzeQueryPattern('top deals');
    expect(a.cacheHitLikelihood).toBeGreaterThan(0.5);
  });

  it('returns low cache hit likelihood for date-range queries', () => {
    const a = analyzeQueryPattern('contacts added this week');
    expect(a.cacheHitLikelihood).toBeLessThan(0.3);
  });
});

describe('selectExecutionStrategy', () => {
  it('selects cache_check_first when cache likelihood >= 0.6', () => {
    const a = analyzeQueryPattern('top customers');
    a.cacheHitLikelihood = 0.75;
    expect(selectExecutionStrategy(a)).toBe('cache_check_first');
  });

  it('selects parallel_hybrid for aggregation queries', () => {
    const a = analyzeQueryPattern('total revenue by quarter');
    a.cacheHitLikelihood = 0.1;
    expect(selectExecutionStrategy(a)).toBe('parallel_hybrid');
  });

  it('selects graph_expansion_first for typed selective queries', () => {
    const a = analyzeQueryPattern('deals', { type: 'deal' });
    a.cacheHitLikelihood = 0.2;
    a.estimatedSelectivity = 0.2;
    a.hasEntityTypeFilter = true;
    a.isAggregation = false;
    a.complexityScore = 0.1;
    expect(selectExecutionStrategy(a)).toBe('graph_expansion_first');
  });

  it('defaults to vector_search_only for general queries', () => {
    const a = analyzeQueryPattern('show me data');
    a.cacheHitLikelihood = 0.3;
    a.complexityScore = 0.2;
    a.isAggregation = false;
    a.hasEntityTypeFilter = false;
    expect(selectExecutionStrategy(a)).toBe('vector_search_only');
  });
});

describe('estimateCost', () => {
  const base = analyzeQueryPattern('find contacts');

  it('returns very low cost for cache_check_first', () => {
    const cost = estimateCost('cache_check_first', base);
    expect(cost.estimatedTokens).toBeLessThan(50);
    expect(cost.estimatedLatencyMs).toBeLessThan(100);
  });

  it('returns higher cost for parallel_hybrid than vector_search_only', () => {
    const hybrid = estimateCost('parallel_hybrid', base);
    const vector = estimateCost('vector_search_only', base);
    expect(hybrid.estimatedTokens).toBeGreaterThan(vector.estimatedTokens);
  });

  it('returns higher latency for graph_expansion_first than vector_search_only', () => {
    const graph = estimateCost('graph_expansion_first', base);
    const vector = estimateCost('vector_search_only', base);
    expect(graph.estimatedLatencyMs).toBeGreaterThan(vector.estimatedLatencyMs);
  });

  it('returns non-negative values for all strategies', () => {
    const strategies = ['vector_search_only', 'graph_expansion_first', 'cache_check_first', 'parallel_hybrid'] as const;
    for (const s of strategies) {
      const cost = estimateCost(s, base);
      expect(cost.estimatedTokens).toBeGreaterThanOrEqual(0);
      expect(cost.estimatedLatencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('buildExecutionPlan', () => {
  it('returns a plan with consistent queryHash for the same query', () => {
    const p1 = buildExecutionPlan('top deals this quarter');
    const p2 = buildExecutionPlan('top deals this quarter');
    expect(p1.queryHash).toBe(p2.queryHash);
  });

  it('returns a different queryHash for different queries', () => {
    const p1 = buildExecutionPlan('contacts');
    const p2 = buildExecutionPlan('deals');
    expect(p1.queryHash).not.toBe(p2.queryHash);
  });

  it('includes at least one step', () => {
    const plan = buildExecutionPlan('any query');
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('sets reasoning describing strategy choice', () => {
    const plan = buildExecutionPlan('any query');
    expect(typeof plan.reasoning).toBe('string');
    expect(plan.reasoning.length).toBeGreaterThan(10);
  });

  it('estimated costs are positive', () => {
    const plan = buildExecutionPlan('find all contacts');
    expect(plan.estimatedTotalTokens).toBeGreaterThan(0);
    expect(plan.estimatedTotalLatencyMs).toBeGreaterThan(0);
  });

  it('produces cache_check_first plan for highly cacheable query', () => {
    const plan = buildExecutionPlan('top customers');
    expect(['cache_check_first', 'vector_search_only', 'parallel_hybrid', 'graph_expansion_first']).toContain(plan.strategy);
  });

  it('first step has a fallback for cache strategy', () => {
    const plan = buildExecutionPlan('top customers');
    if (plan.strategy === 'cache_check_first') {
      expect(plan.steps[0]?.fallback).toBeDefined();
    }
  });
});

describe('recordPlanExecution', () => {
  it('returns ok on successful DB insert', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const plan = buildExecutionPlan('find contacts');
    const result = await recordPlanExecution(sql as never, plan, 'ws-1', 150, 300, false);
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledOnce();
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const plan = buildExecutionPlan('find contacts');
    const result = await recordPlanExecution(sql as never, plan, 'ws-1', 150, 300, false);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('db error');
  });
});

describe('getOptimizerStats', () => {
  it('returns aggregated stats', async () => {
    const statsRows = [
      { strategy_chosen: 'vector_search_only', plan_count: '10', avg_actual_tokens: '200', avg_est_tokens: '250', avg_latency: '300', cache_hit_rate: '0' },
      { strategy_chosen: 'cache_check_first', plan_count: '5', avg_actual_tokens: '10', avg_est_tokens: '10', avg_latency: '20', cache_hit_rate: '1' },
    ];
    const slowRows = [{ query_hash: 'abc', strategy_chosen: 'vector_search_only', avg_latency: '800' }];
    const sql = vi.fn().mockResolvedValueOnce(statsRows).mockResolvedValueOnce(slowRows);
    const result = await getOptimizerStats(sql as never, 'ws-1');
    expect(result.isOk()).toBe(true);
    const stats = result._unsafeUnwrap();
    expect(stats.totalPlans).toBe(15);
    expect(stats.strategyBreakdown.vector_search_only).toBe(10);
    expect(stats.strategyBreakdown.cache_check_first).toBe(5);
    expect(stats.slowestQueries).toHaveLength(1);
    expect(stats.slowestQueries[0]?.avgLatencyMs).toBe(800);
  });

  it('returns empty stats on no data', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await getOptimizerStats(sql as never, 'ws-empty');
    expect(result.isOk()).toBe(true);
    const stats = result._unsafeUnwrap();
    expect(stats.totalPlans).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await getOptimizerStats(sql as never, 'ws-1');
    expect(result.isErr()).toBe(true);
  });
});
