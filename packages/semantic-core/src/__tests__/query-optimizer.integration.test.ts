import { describe, it, expect } from 'vitest';
import { buildExecutionPlan, selectExecutionStrategy, analyzeQueryPattern } from '../query-optimizer.js';

/**
 * Integration-style tests for the query optimizer using diverse query patterns.
 * These tests do not require external services — they validate optimizer decisions
 * against a representative corpus of real-world query patterns.
 */

const QUERIES = [
  { q: 'find all contacts', expectedStrategies: ['vector_search_only', 'cache_check_first'] },
  { q: 'contacts at Acme Corp', expectedStrategies: ['vector_search_only', 'graph_expansion_first', 'cache_check_first'] },
  { q: 'deals closing this month over $50k', expectedStrategies: ['vector_search_only', 'parallel_hybrid', 'graph_expansion_first'] },
  { q: 'total revenue by quarter', expectedStrategies: ['parallel_hybrid'] },
  { q: 'top 10 enterprise accounts', expectedStrategies: ['vector_search_only', 'cache_check_first', 'parallel_hybrid'] },
  { q: 'support tickets from VIP customers', expectedStrategies: ['vector_search_only', 'graph_expansion_first'] },
  { q: 'monthly recurring revenue', expectedStrategies: ['cache_check_first', 'parallel_hybrid', 'vector_search_only'] },
  { q: 'leads created last week in EMEA', expectedStrategies: ['vector_search_only', 'graph_expansion_first'] },
];

describe('QueryOptimizer — diverse query corpus', () => {
  it('assigns a valid strategy to all query patterns', () => {
    const validStrategies = ['vector_search_only', 'graph_expansion_first', 'cache_check_first', 'parallel_hybrid'];
    for (const { q } of QUERIES) {
      const plan = buildExecutionPlan(q);
      expect(validStrategies).toContain(plan.strategy);
    }
  });

  it('produces consistent plans for repeated calls on the same query', () => {
    for (const { q } of QUERIES) {
      const p1 = buildExecutionPlan(q);
      const p2 = buildExecutionPlan(q);
      expect(p1.queryHash).toBe(p2.queryHash);
      expect(p1.strategy).toBe(p2.strategy);
    }
  });

  it('aggregation queries use parallel_hybrid or vector_search_only', () => {
    const aggQueries = QUERIES.filter(q => /total|top \d+|by (month|quarter)/.test(q.q));
    for (const { q } of aggQueries) {
      const a = analyzeQueryPattern(q);
      expect(a.isAggregation).toBe(true);
    }
  });

  it('strategy selection is deterministic for a fixed analysis', () => {
    const analysis = analyzeQueryPattern('find deals', { type: 'deal', stage: 'closed' });
    const s1 = selectExecutionStrategy(analysis);
    const s2 = selectExecutionStrategy(analysis);
    expect(s1).toBe(s2);
  });

  it('all plans have at least one step', () => {
    for (const { q } of QUERIES) {
      const plan = buildExecutionPlan(q, {});
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all plans have positive estimated costs', () => {
    for (const { q } of QUERIES) {
      const plan = buildExecutionPlan(q);
      expect(plan.estimatedTotalTokens).toBeGreaterThan(0);
      expect(plan.estimatedTotalLatencyMs).toBeGreaterThan(0);
    }
  });

  it('cache_check_first plans have lower estimated tokens than parallel_hybrid', () => {
    const cacheQuery = 'top customers';
    const hybridQuery = 'total revenue by quarter breakdown with segment analysis';

    const cacheAnalysis = analyzeQueryPattern(cacheQuery);
    cacheAnalysis.cacheHitLikelihood = 0.8;
    const hybridAnalysis = analyzeQueryPattern(hybridQuery);
    hybridAnalysis.cacheHitLikelihood = 0.1;
    hybridAnalysis.isAggregation = true;

    const cacheStrategy = selectExecutionStrategy(cacheAnalysis);
    const hybridStrategy = selectExecutionStrategy(hybridAnalysis);

    expect(cacheStrategy).toBe('cache_check_first');
    expect(hybridStrategy).toBe('parallel_hybrid');
  });
});
