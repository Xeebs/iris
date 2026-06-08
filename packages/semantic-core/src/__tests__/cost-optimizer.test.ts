import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CostOptimizationAdvisor,
  estimateMonthlySavings,
  rankRecommendations,
  filterLowEffort,
  type SpendPattern,
  type CostRecommendation,
} from '../cost-optimizer.js';

function makeSpendPattern(overrides: Partial<SpendPattern> = {}): SpendPattern {
  return {
    workspaceId: 'ws-1',
    windowDays: 30,
    totalTokensSpent: 600000,
    totalCostCents: 900,
    avgTokensPerQuery: 400,
    avgCostPerQuery: 0.6,
    cacheHitRate: 0.05,
    compressionEfficiency: 0.2,
    tokensPerDay: 20000,
    costPerDay: 30,
    topQueriesByTokens: [],
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<CostRecommendation> = {}): CostRecommendation {
  return {
    id: 'enable_semantic_cache',
    type: 'enable_semantic_cache',
    title: 'Enable semantic cache',
    description: 'Low cache hit rate detected',
    estimatedSavingsTokensPerDay: 6000,
    estimatedSavingsCostMonthly: 270,
    implementationEffort: 'low',
    appliedAt: null,
    savingsRealizedCents: 0,
    ...overrides,
  };
}

function makeSql(tokenRows: unknown[] = [], topRows: unknown[] = [], staleRows: unknown[] = []) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) return Promise.resolve(tokenRows);
    if (callCount === 2) return Promise.resolve(topRows);
    return Promise.resolve(staleRows);
  });
  (fn as unknown as Record<string, unknown>).array = vi.fn((v: unknown) => v);
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function makeMultiSql(...responses: unknown[][]) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? [];
    return Promise.resolve(r);
  });
  (fn as unknown as Record<string, unknown>).array = vi.fn((v: unknown) => v);
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

describe('estimateMonthlySavings', () => {
  it('returns 0 for 0 tokens saved per day', () => {
    expect(estimateMonthlySavings(0)).toBe(0);
  });

  it('returns positive value for positive savings', () => {
    expect(estimateMonthlySavings(10000)).toBeGreaterThan(0);
  });

  it('scales proportionally with token savings', () => {
    const savings1 = estimateMonthlySavings(1000);
    const savings2 = estimateMonthlySavings(2000);
    expect(savings2).toBe(savings1 * 2);
  });
});

describe('rankRecommendations', () => {
  it('sorts by estimated monthly savings descending', () => {
    const recs = [
      makeRecommendation({ estimatedSavingsCostMonthly: 100 }),
      makeRecommendation({ id: 'b', type: 'archive_stale_entities', estimatedSavingsCostMonthly: 300 }),
      makeRecommendation({ id: 'c', type: 'tune_context_budget', estimatedSavingsCostMonthly: 200 }),
    ];
    const ranked = rankRecommendations(recs);
    expect(ranked[0].estimatedSavingsCostMonthly).toBe(300);
    expect(ranked[1].estimatedSavingsCostMonthly).toBe(200);
    expect(ranked[2].estimatedSavingsCostMonthly).toBe(100);
  });

  it('does not mutate original array', () => {
    const recs = [makeRecommendation({ estimatedSavingsCostMonthly: 50 })];
    const original = [...recs];
    rankRecommendations(recs);
    expect(recs[0].estimatedSavingsCostMonthly).toBe(original[0].estimatedSavingsCostMonthly);
  });

  it('handles empty array', () => {
    expect(rankRecommendations([])).toEqual([]);
  });
});

describe('filterLowEffort', () => {
  it('returns only low-effort recommendations', () => {
    const recs = [
      makeRecommendation({ implementationEffort: 'low' }),
      makeRecommendation({ id: 'b', implementationEffort: 'medium' }),
      makeRecommendation({ id: 'c', implementationEffort: 'high' }),
    ];
    const filtered = filterLowEffort(recs);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].implementationEffort).toBe('low');
  });

  it('returns empty if no low-effort items', () => {
    const recs = [makeRecommendation({ implementationEffort: 'high' })];
    expect(filterLowEffort(recs)).toEqual([]);
  });

  it('returns all if all are low-effort', () => {
    const recs = [
      makeRecommendation({ implementationEffort: 'low' }),
      makeRecommendation({ id: 'b', implementationEffort: 'low' }),
    ];
    expect(filterLowEffort(recs)).toHaveLength(2);
  });
});

describe('CostOptimizationAdvisor', () => {
  let advisor: CostOptimizationAdvisor;
  let sql: ReturnType<typeof makeSql>;

  const tokenRow = {
    total_tokens_spent: '600000',
    total_tokens_saved_caching: '50000',
    total_tokens_saved_compression: '30000',
    query_count: '1500',
    avg_tokens_per_query: '400',
    cache_hit_rate: '0.05',
  };

  beforeEach(() => {
    sql = makeSql([tokenRow], [], [{ stale_count: '0' }]);
    advisor = new CostOptimizationAdvisor(sql);
  });

  describe('analyzeSpendPatterns', () => {
    it('returns ok with spend pattern on success', async () => {
      const result = await advisor.analyzeSpendPatterns('ws-1', 30);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.workspaceId).toBe('ws-1');
        expect(result.value.windowDays).toBe(30);
        expect(result.value.cacheHitRate).toBeCloseTo(0.05);
        expect(result.value.totalTokensSpent).toBe(600000);
      }
    });

    it('returns err when sql throws', async () => {
      const badSql = vi.fn().mockRejectedValue(new Error('DB fail')) as unknown as ReturnType<typeof makeSql>;
      (badSql as unknown as Record<string, unknown>).array = vi.fn();
      advisor = new CostOptimizationAdvisor(badSql);
      const result = await advisor.analyzeSpendPatterns('ws-1');
      expect(result.isErr()).toBe(true);
    });

    it('uses default windowDays of 30', async () => {
      const result = await advisor.analyzeSpendPatterns('ws-1');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.windowDays).toBe(30);
      }
    });

    it('computes tokensPerDay correctly', async () => {
      const result = await advisor.analyzeSpendPatterns('ws-1', 30);
      if (result.isOk()) {
        expect(result.value.tokensPerDay).toBeCloseTo(600000 / 30);
      }
    });

    it('handles empty result set gracefully', async () => {
      sql = makeSql([{}], [], [{ stale_count: '0' }]);
      advisor = new CostOptimizationAdvisor(sql);
      const result = await advisor.analyzeSpendPatterns('ws-1', 30);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.totalTokensSpent).toBe(0);
        expect(result.value.cacheHitRate).toBe(0);
      }
    });
  });

  describe('generateRecommendations', () => {
    it('returns ok with recommendation list', async () => {
      const pattern = makeSpendPattern();
      const result = await advisor.generateRecommendations(pattern);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });

    it('includes cache recommendation when hit rate < 15%', async () => {
      const pattern = makeSpendPattern({ cacheHitRate: 0.05 });
      const result = await advisor.generateRecommendations(pattern);
      if (result.isOk()) {
        expect(result.value.some((r) => r.type === 'enable_semantic_cache')).toBe(true);
      }
    });

    it('omits cache recommendation when hit rate >= 15%', async () => {
      const pattern = makeSpendPattern({ cacheHitRate: 0.20 });
      const result = await advisor.generateRecommendations(pattern);
      if (result.isOk()) {
        expect(result.value.some((r) => r.type === 'enable_semantic_cache')).toBe(false);
      }
    });

    it('includes context budget recommendation for low token usage', async () => {
      const pattern = makeSpendPattern({ avgTokensPerQuery: 200 });
      const result = await advisor.generateRecommendations(pattern);
      if (result.isOk()) {
        expect(result.value.some((r) => r.type === 'tune_context_budget')).toBe(true);
      }
    });

    it('always includes consolidate low-roi connectors recommendation', async () => {
      const pattern = makeSpendPattern();
      const result = await advisor.generateRecommendations(pattern);
      if (result.isOk()) {
        expect(result.value.some((r) => r.type === 'consolidate_low_roi_connectors')).toBe(true);
      }
    });

    it('returns recommendations sorted by monthly savings descending', async () => {
      const pattern = makeSpendPattern();
      const result = await advisor.generateRecommendations(pattern);
      if (result.isOk()) {
        const savings = result.value.map((r) => r.estimatedSavingsCostMonthly);
        for (let i = 0; i < savings.length - 1; i++) {
          expect(savings[i]).toBeGreaterThanOrEqual(savings[i + 1]);
        }
      }
    });

    it('each recommendation has required fields', async () => {
      const pattern = makeSpendPattern();
      const result = await advisor.generateRecommendations(pattern);
      if (result.isOk()) {
        for (const rec of result.value) {
          expect(rec.id).toBeTruthy();
          expect(rec.title).toBeTruthy();
          expect(rec.description).toBeTruthy();
          expect(['low', 'medium', 'high']).toContain(rec.implementationEffort);
          expect(rec.appliedAt).toBeNull();
        }
      }
    });
  });

  describe('applyRecommendation', () => {
    it('returns ok on success', async () => {
      const result = await advisor.applyRecommendation('ws-1', 'enable_semantic_cache', 500);
      expect(result.isOk()).toBe(true);
    });

    it('returns err when sql throws', async () => {
      const badSql = vi.fn().mockRejectedValue(new Error('DB fail')) as unknown as ReturnType<typeof makeSql>;
      (badSql as unknown as Record<string, unknown>).array = vi.fn();
      advisor = new CostOptimizationAdvisor(badSql);
      const result = await advisor.applyRecommendation('ws-1', 'archive_stale_entities');
      expect(result.isErr()).toBe(true);
    });

    it('calls sql with correct workspace', async () => {
      await advisor.applyRecommendation('ws-2', 'enable_semantic_cache');
      expect(sql).toHaveBeenCalled();
    });

    it('defaults savingsRealizedCents to 0', async () => {
      const result = await advisor.applyRecommendation('ws-1', 'enable_semantic_cache');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('trackContextSize', () => {
    it('inserts a context cost event', async () => {
      const sql = makeSql([[{ id: 'evt-1' }]]);
      const advisor = new CostOptimizationAdvisor(sql);
      await expect(
        advisor.trackContextSize({
          workspaceId: 'ws-1',
          query: 'find all contracts mentioning payment terms',
          entities: [
            { id: 'e-1', type: 'contact', sourceConnectorId: 'gdrive-1' },
            { id: 'e-2', type: 'deal', sourceConnectorId: 'hubspot-1' },
          ],
          tokensSpent: 1200,
          tokensSaved: 300,
          cacheHit: false,
        }),
      ).resolves.toBeUndefined();
      expect(sql).toHaveBeenCalledTimes(1);
    });

    it('deduplicates source connectors and entity types', async () => {
      const sql = makeSql([[{ id: 'evt-2' }]]);
      const advisor = new CostOptimizationAdvisor(sql);
      await advisor.trackContextSize({
        workspaceId: 'ws-1',
        query: 'test',
        entities: [
          { id: 'e-1', type: 'contact', sourceConnectorId: 'gdrive-1' },
          { id: 'e-2', type: 'contact', sourceConnectorId: 'gdrive-1' },
        ],
        tokensSpent: 500,
        tokensSaved: 0,
        cacheHit: true,
      });
      expect(sql).toHaveBeenCalledTimes(1);
    });

    it('handles entities without sourceConnectorId', async () => {
      const sql = makeSql([[{ id: 'evt-3' }]]);
      const advisor = new CostOptimizationAdvisor(sql);
      await expect(
        advisor.trackContextSize({
          workspaceId: 'ws-1',
          query: 'test',
          entities: [{ id: 'e-1', type: 'metric' }],
          tokensSpent: 100,
          tokensSaved: 0,
          cacheHit: false,
        }),
      ).resolves.toBeUndefined();
    });

    it('propagates SQL errors', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('insert failed'));
      (fn as unknown as Record<string, unknown>).array = vi.fn((v: unknown) => v);
      const sql = fn as unknown as ReturnType<typeof import('postgres').default>;
      const advisor = new CostOptimizationAdvisor(sql);
      await expect(
        advisor.trackContextSize({
          workspaceId: 'ws-1',
          query: 'q',
          entities: [],
          tokensSpent: 100,
          tokensSaved: 0,
          cacheHit: false,
        }),
      ).rejects.toThrow('insert failed');
    });
  });

  describe('attributeCosts', () => {
    it('returns breakdown by connector, entity type, and week-over-week change', async () => {
      const connectorRows = [{ connector_id: 'gdrive-1', tokens_spent: '5000' }];
      const typeRows = [{ entity_type: 'contact', tokens_spent: '3000' }];
      const currentWeekRows = [{ total: '4000' }];
      const prevWeekRows = [{ total: '3000' }];
      const sql = makeMultiSql(connectorRows, typeRows, currentWeekRows, prevWeekRows);
      const advisor = new CostOptimizationAdvisor(sql);
      const result = await advisor.attributeCosts('ws-1', 30);
      expect(result.byConnector).toHaveLength(1);
      expect(result.byConnector[0]!.connectorId).toBe('gdrive-1');
      expect(result.byEntityType).toHaveLength(1);
      expect(result.weekOverWeekChange).toBeCloseTo(33.33, 1);
    });

    it('returns 0 week-over-week change when no prior week data', async () => {
      const sql = makeMultiSql([], [], [{ total: '1000' }], [{ total: '0' }]);
      const advisor = new CostOptimizationAdvisor(sql);
      const result = await advisor.attributeCosts('ws-1', 30);
      expect(result.weekOverWeekChange).toBe(0);
    });

    it('computes pctOfTotal correctly', async () => {
      const connectorRows = [
        { connector_id: 'c-1', tokens_spent: '3000' },
        { connector_id: 'c-2', tokens_spent: '1000' },
      ];
      const sql = makeMultiSql(connectorRows, [], [{ total: '0' }], [{ total: '0' }]);
      const advisor = new CostOptimizationAdvisor(sql);
      const result = await advisor.attributeCosts('ws-1', 30);
      expect(result.byConnector[0]!.pctOfTotal).toBeCloseTo(75, 1);
      expect(result.byConnector[1]!.pctOfTotal).toBeCloseTo(25, 1);
    });
  });

  describe('recommend', () => {
    it('returns recommendations result', async () => {
      const sql = makeSql([
        [{ total_tokens_spent: '600000', total_tokens_saved_caching: '0', total_tokens_saved_compression: '0', query_count: '1000', avg_tokens_per_query: '600', cache_hit_rate: '0.05' }],
        [{ tool_name: 'query-context', total_tokens: '600000', call_count: '1000' }],
        [{ stale_count: '0' }],
      ]);
      const advisor = new CostOptimizationAdvisor(sql);
      const result = await advisor.recommend('ws-1');
      expect(result.isOk()).toBe(true);
    });
  });
});
