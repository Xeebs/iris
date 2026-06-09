import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MultiConnectorQueryOptimizer,
  type ConnectorMeta,
  type ExecutionConstraints,
} from '../multi-connector-optimizer.js';

function makeSql() {
  const fn = vi.fn(() => Promise.resolve([]));
  (fn as Record<string, unknown>).array = (arr: unknown) => arr;
  (fn as Record<string, unknown>).json = (obj: unknown) => obj;
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

const connectors: ConnectorMeta[] = [
  {
    connectorId: 'hubspot',
    entityTypes: ['contact', 'company', 'deal'],
    avgLatencyMs: 200,
    cacheHitRate: 0.4,
    costPerRequest: 2,
  },
  {
    connectorId: 'salesforce',
    entityTypes: ['account', 'opportunity', 'lead'],
    avgLatencyMs: 350,
    cacheHitRate: 0.3,
    costPerRequest: 4,
  },
  {
    connectorId: 'slack',
    entityTypes: ['user', 'channel', 'message'],
    avgLatencyMs: 80,
    cacheHitRate: 0.6,
    costPerRequest: 1,
  },
];

const defaultConstraints: ExecutionConstraints = {
  maxLatencyMs: 2000,
  maxTokens: 4000,
  preferLowCost: false,
};

describe('MultiConnectorQueryOptimizer', () => {
  let optimizer: MultiConnectorQueryOptimizer;
  let sql: ReturnType<typeof makeSql>;

  beforeEach(() => {
    sql = makeSql();
    optimizer = new MultiConnectorQueryOptimizer(sql);
    vi.clearAllMocks();
  });

  describe('analyzeQueryConnectorAffinity', () => {
    it('returns all connectors for broad query', () => {
      const result = optimizer.analyzeQueryConnectorAffinity('show me contacts and deals', connectors);
      expect(result).toHaveLength(3);
    });

    it('ranks connectors by entity type overlap', () => {
      const result = optimizer.analyzeQueryConnectorAffinity('contacts and companies', connectors);
      expect(result[0]!.connectorId).toBe('hubspot');
    });

    it('returns relevanceScore between 0 and 1', () => {
      const result = optimizer.analyzeQueryConnectorAffinity('deals', connectors);
      for (const r of result) {
        expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(r.relevanceScore).toBeLessThanOrEqual(1);
      }
    });

    it('includes matchedEntityTypes for relevant connectors', () => {
      const result = optimizer.analyzeQueryConnectorAffinity('contact', connectors);
      const hubspot = result.find((r) => r.connectorId === 'hubspot');
      expect(hubspot?.matchedEntityTypes).toContain('contact');
    });

    it('returns 0.5 relevanceScore when query has no keywords', () => {
      const result = optimizer.analyzeQueryConnectorAffinity('what is happening', connectors);
      for (const r of result) {
        expect(r.relevanceScore).toBe(0.5);
      }
    });

    it('returns empty array for empty connector list', () => {
      const result = optimizer.analyzeQueryConnectorAffinity('contacts', []);
      expect(result).toHaveLength(0);
    });
  });

  describe('rankExecutionStrategies', () => {
    it('returns 4 strategies', () => {
      const ranked = optimizer.rankExecutionStrategies(connectors, 8000, 2000);
      expect(ranked).toHaveLength(4);
    });

    it('strategies are ordered by score descending', () => {
      const ranked = optimizer.rankExecutionStrategies(connectors, 8000, 2000);
      for (let i = 0; i < ranked.length - 1; i++) {
        expect(ranked[i]!.score).toBeGreaterThanOrEqual(ranked[i + 1]!.score);
      }
    });

    it('all strategies have non-negative latency estimates', () => {
      const ranked = optimizer.rankExecutionStrategies(connectors, 8000, 2000);
      for (const r of ranked) {
        expect(r.estimatedLatencyP95Ms).toBeGreaterThanOrEqual(0);
      }
    });

    it('parallel strategy has highest token estimate', () => {
      const ranked = optimizer.rankExecutionStrategies(connectors, 8000, 2000);
      const parallel = ranked.find((r) => r.strategy === 'parallel');
      const sequential = ranked.find((r) => r.strategy === 'sequential');
      expect(parallel!.estimatedTokens).toBeGreaterThanOrEqual(sequential!.estimatedTokens);
    });

    it('returns empty array for empty connector list', () => {
      const ranked = optimizer.rankExecutionStrategies([], 8000, 2000);
      expect(ranked).toHaveLength(0);
    });

    it('each strategy has pros and cons arrays', () => {
      const ranked = optimizer.rankExecutionStrategies(connectors, 8000, 2000);
      for (const r of ranked) {
        expect(Array.isArray(r.pros)).toBe(true);
        expect(Array.isArray(r.cons)).toBe(true);
        expect(r.pros.length).toBeGreaterThan(0);
      }
    });
  });

  describe('estimateExecutionCost', () => {
    it('returns cost estimate for parallel strategy', () => {
      const cost = optimizer.estimateExecutionCost('parallel', connectors);
      expect(cost.latencyP95Ms).toBeGreaterThan(0);
      expect(cost.tokens).toBeGreaterThan(0);
      expect(cost.cost).toBeGreaterThan(0);
    });

    it('sequential strategy has lower cost than parallel', () => {
      const parallel = optimizer.estimateExecutionCost('parallel', connectors);
      const sequential = optimizer.estimateExecutionCost('sequential', connectors);
      expect(sequential.cost).toBeLessThan(parallel.cost);
    });

    it('returns zero cost for empty connector list', () => {
      const cost = optimizer.estimateExecutionCost('parallel', []);
      expect(cost.latencyP95Ms).toBe(0);
      expect(cost.tokens).toBe(0);
    });
  });

  describe('selectOptimalStrategy', () => {
    it('returns a plan with the required fields', () => {
      const plan = optimizer.selectOptimalStrategy('contacts', connectors, 8000, defaultConstraints);
      expect(plan).toHaveProperty('strategy');
      expect(plan).toHaveProperty('connectors');
      expect(plan).toHaveProperty('estimatedLatencyP95Ms');
      expect(plan).toHaveProperty('estimatedTokens');
      expect(plan).toHaveProperty('estimatedCost');
      expect(plan).toHaveProperty('strategyRankings');
      expect(plan).toHaveProperty('reasoning');
    });

    it('selected connectors are a subset of input connectors', () => {
      const plan = optimizer.selectOptimalStrategy('contacts', connectors, 8000, defaultConstraints);
      for (const id of plan.connectors) {
        expect(connectors.some((c) => c.connectorId === id)).toBe(true);
      }
    });

    it('prefers lower-cost strategy when preferLowCost is true', () => {
      const highCost: ExecutionConstraints = { ...defaultConstraints, preferLowCost: true };
      const plan = optimizer.selectOptimalStrategy('deals', connectors, 8000, highCost);
      expect(['sequential', 'cached-first']).toContain(plan.strategy);
    });

    it('reasoning is a non-empty string', () => {
      const plan = optimizer.selectOptimalStrategy('users', connectors, 8000, defaultConstraints);
      expect(typeof plan.reasoning).toBe('string');
      expect(plan.reasoning.length).toBeGreaterThan(10);
    });

    it('handles empty connector list gracefully', () => {
      const plan = optimizer.selectOptimalStrategy('contacts', [], 8000, defaultConstraints);
      expect(plan.connectors).toHaveLength(0);
      expect(plan.strategyRankings).toHaveLength(0);
    });
  });

  describe('recordPlan', () => {
    it('calls sql with INSERT and returns plan with planId', async () => {
      const planData = {
        query: 'get contacts',
        strategy: 'parallel' as const,
        connectors: ['hubspot'],
        estimatedLatencyP95Ms: 240,
        estimatedTokens: 1200,
        estimatedCost: 2.4,
        strategyRankings: [],
        reasoning: 'parallel selected',
      };
      const plan = await optimizer.recordPlan('ws-1', planData);
      expect(plan.planId).toHaveLength(32);
      expect(plan.workspaceId).toBe('ws-1');
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('getPlanHistory', () => {
    it('calls sql with workspace filter', async () => {
      const result = await optimizer.getPlanHistory('ws-1', 10);
      expect(result.plans).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
      expect(sql).toHaveBeenCalled();
    });

    it('uses cursor when provided', async () => {
      await optimizer.getPlanHistory('ws-1', 10, 'some-cursor');
      expect(sql).toHaveBeenCalled();
    });
  });
});
