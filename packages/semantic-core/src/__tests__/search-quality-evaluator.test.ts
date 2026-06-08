import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  precisionAtK,
  recallAtK,
  ndcgAtK,
  meanReciprocalRank,
  computeMetrics,
  averageMetrics,
  compareStrategies,
  SearchQualityEvaluator,
} from '../search-quality-evaluator.js';
import type postgres from 'postgres';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

type SqlClient = ReturnType<typeof postgres>;

function makeSql(rows: unknown[] = []): SqlClient {
  return vi.fn().mockResolvedValue(rows) as unknown as SqlClient;
}

// ─── precisionAtK ─────────────────────────────────────────────────────────────

describe('precisionAtK', () => {
  const expected = ['e1', 'e2', 'e3'];

  it('returns 1 when all top-K are relevant', () => {
    expect(precisionAtK(['e1', 'e2', 'e3'], expected, 3)).toBe(1);
  });

  it('returns 0 when no top-K are relevant', () => {
    expect(precisionAtK(['x', 'y', 'z'], expected, 3)).toBe(0);
  });

  it('returns 0.5 for half-relevant top-2', () => {
    expect(precisionAtK(['e1', 'x'], expected, 2)).toBe(0.5);
  });

  it('returns 0 for k=0', () => {
    expect(precisionAtK(['e1'], expected, 0)).toBe(0);
  });

  it('returns 0 for empty retrieved list', () => {
    expect(precisionAtK([], expected, 5)).toBe(0);
  });

  it('ignores results beyond K', () => {
    expect(precisionAtK(['x', 'y', 'e1', 'e2'], expected, 2)).toBe(0);
  });
});

// ─── recallAtK ───────────────────────────────────────────────────────────────

describe('recallAtK', () => {
  const expected = ['e1', 'e2', 'e3'];

  it('returns 1 when all relevant are in top-K', () => {
    expect(recallAtK(['e1', 'e2', 'e3', 'x'], expected, 5)).toBe(1);
  });

  it('returns 0 when none relevant in top-K', () => {
    expect(recallAtK(['x', 'y'], expected, 2)).toBe(0);
  });

  it('returns 1/3 when one of three relevant in top-K', () => {
    expect(recallAtK(['e1', 'x', 'y'], expected, 3)).toBeCloseTo(1 / 3, 3);
  });

  it('returns 0 for empty retrieved', () => {
    expect(recallAtK([], expected, 5)).toBe(0);
  });
});

// ─── ndcgAtK ─────────────────────────────────────────────────────────────────

describe('ndcgAtK', () => {
  it('returns 1 for perfect ranking', () => {
    expect(ndcgAtK(['e1', 'e2'], ['e1', 'e2'], 2)).toBe(1);
  });

  it('returns 0 when no relevant in results', () => {
    expect(ndcgAtK(['x', 'y'], ['e1', 'e2'], 2)).toBe(0);
  });

  it('is higher when relevant result appears earlier', () => {
    const ndcg_good = ndcgAtK(['e1', 'x'], ['e1', 'e2'], 2);
    const ndcg_bad = ndcgAtK(['x', 'e1'], ['e1', 'e2'], 2);
    expect(ndcg_good).toBeGreaterThan(ndcg_bad);
  });

  it('uses graded relevance scores when provided', () => {
    const scores = { e1: 1, e2: 0.5 };
    const ndcg = ndcgAtK(['e2', 'e1'], ['e1', 'e2'], 2, scores);
    expect(ndcg).toBeGreaterThan(0);
    expect(ndcg).toBeLessThan(1); // not perfect because order is suboptimal
  });

  it('returns 0 for k=0', () => {
    expect(ndcgAtK(['e1'], ['e1'], 0)).toBe(0);
  });
});

// ─── meanReciprocalRank ───────────────────────────────────────────────────────

describe('meanReciprocalRank', () => {
  it('returns 1 when first result is relevant', () => {
    expect(meanReciprocalRank(['e1', 'x'], ['e1'])).toBe(1);
  });

  it('returns 0.5 when second result is relevant', () => {
    expect(meanReciprocalRank(['x', 'e1'], ['e1'])).toBe(0.5);
  });

  it('returns 1/3 when third result is relevant', () => {
    expect(meanReciprocalRank(['x', 'y', 'e1'], ['e1'])).toBeCloseTo(1 / 3, 3);
  });

  it('returns 0 when no relevant result found', () => {
    expect(meanReciprocalRank(['x', 'y'], ['e1'])).toBe(0);
  });

  it('returns 0 for empty lists', () => {
    expect(meanReciprocalRank([], ['e1'])).toBe(0);
    expect(meanReciprocalRank(['e1'], [])).toBe(0);
  });
});

// ─── computeMetrics ──────────────────────────────────────────────────────────

describe('computeMetrics', () => {
  it('returns all four metrics', () => {
    const m = computeMetrics(['e1', 'e2', 'x'], ['e1', 'e2'], 2);
    expect(m.precisionAtK).toBeGreaterThan(0);
    expect(m.recallAtK).toBeGreaterThan(0);
    expect(m.ndcgAtK).toBeGreaterThan(0);
    expect(m.mrr).toBeGreaterThan(0);
    expect(m.sampleSize).toBe(1);
  });

  it('uses default k=5', () => {
    const m = computeMetrics(['e1'], ['e1']);
    expect(m.precisionAtK).toBe(1);
  });
});

// ─── averageMetrics ───────────────────────────────────────────────────────────

describe('averageMetrics', () => {
  it('returns zeros for empty array', () => {
    const avg = averageMetrics([]);
    expect(avg.precisionAtK).toBe(0);
    expect(avg.sampleSize).toBe(0);
  });

  it('averages correctly across two metrics', () => {
    const m1 = { precisionAtK: 0.8, recallAtK: 0.6, ndcgAtK: 0.7, mrr: 0.5, sampleSize: 1 };
    const m2 = { precisionAtK: 0.4, recallAtK: 0.2, ndcgAtK: 0.3, mrr: 0.25, sampleSize: 1 };
    const avg = averageMetrics([m1, m2]);
    expect(avg.precisionAtK).toBeCloseTo(0.6, 4);
    expect(avg.ndcgAtK).toBeCloseTo(0.5, 4);
    expect(avg.sampleSize).toBe(2);
  });
});

// ─── compareStrategies ────────────────────────────────────────────────────────

describe('compareStrategies', () => {
  const baseMetrics = { precisionAtK: 0.5, recallAtK: 0.4, ndcgAtK: 0.5, mrr: 0.4, sampleSize: 100 };

  it('returns treatment as winner when NDCG significantly improved', () => {
    const comparison = compareStrategies(
      { strategy: 'bm25', metrics: baseMetrics },
      { strategy: 'hybrid', metrics: { ...baseMetrics, ndcgAtK: 0.62 } },
    );
    expect(comparison.winner).toBe('hybrid');
    expect(comparison.improvement?.metric).toBe('ndcgAtK');
    expect(comparison.improvement?.delta).toBeCloseTo(0.12, 2);
  });

  it('returns control as winner when control NDCG is better', () => {
    const comparison = compareStrategies(
      { strategy: 'vector', metrics: { ...baseMetrics, ndcgAtK: 0.7 } },
      { strategy: 'bm25', metrics: baseMetrics },
    );
    expect(comparison.winner).toBe('vector');
  });

  it('returns null winner when difference is within noise threshold', () => {
    const comparison = compareStrategies(
      { strategy: 'vector', metrics: baseMetrics },
      { strategy: 'bm25', metrics: { ...baseMetrics, ndcgAtK: 0.505 } },
    );
    expect(comparison.winner).toBeNull();
  });
});

// ─── SearchQualityEvaluator service ──────────────────────────────────────────

describe('SearchQualityEvaluator', () => {
  let sql: SqlClient;
  let evaluator: SearchQualityEvaluator;

  const WORKSPACE = 'ws-1';
  const experimentRow = {
    id: 'exp-1',
    workspace_id: WORKSPACE,
    name: 'bm25-vs-hybrid',
    control_strategy: 'bm25',
    treatment_strategy: 'hybrid',
    test_set_id: null,
    traffic_pct: 10,
    status: 'running',
    winner: null,
    created_by: null,
    created_at: new Date('2026-06-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSql([{ id: 'ts-1' }]);
    evaluator = new SearchQualityEvaluator(sql);
  });

  describe('defineTestSet()', () => {
    it('returns test set info on success', async () => {
      const result = await evaluator.defineTestSet(WORKSPACE, 'set-1', [
        { query: 'find contacts', expectedEntityIds: ['e1', 'e2'] },
      ]);
      expect(result.isOk()).toBe(true);
      const ts = result._unsafeUnwrap();
      expect(ts.name).toBe('set-1');
      expect(ts.queryCount).toBe(1);
    });

    it('returns err on DB failure', async () => {
      sql = vi.fn().mockRejectedValue(new Error('unique conflict')) as unknown as SqlClient;
      evaluator = new SearchQualityEvaluator(sql);
      const result = await evaluator.defineTestSet(WORKSPACE, 'x', []);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('createExperiment()', () => {
    it('returns created experiment', async () => {
      sql = makeSql([experimentRow]);
      evaluator = new SearchQualityEvaluator(sql);
      const result = await evaluator.createExperiment(WORKSPACE, 'bm25-vs-hybrid', 'bm25', 'hybrid');
      expect(result.isOk()).toBe(true);
      const exp = result._unsafeUnwrap();
      expect(exp.controlStrategy).toBe('bm25');
      expect(exp.trafficPct).toBe(10);
      expect(exp.status).toBe('running');
    });

    it('returns err on DB failure', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as SqlClient;
      evaluator = new SearchQualityEvaluator(sql);
      const result = await evaluator.createExperiment(WORKSPACE, 'x', 'vector', 'bm25');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('recordResult()', () => {
    it('returns ok on success', async () => {
      sql = makeSql([]);
      evaluator = new SearchQualityEvaluator(sql);
      const metrics = { precisionAtK: 0.8, recallAtK: 0.7, ndcgAtK: 0.75, mrr: 0.6, sampleSize: 50 };
      const result = await evaluator.recordResult('exp-1', 'control', metrics);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('getResults()', () => {
    it('maps aggregated rows to strategy metrics', async () => {
      const rows = [
        { strategy_name: 'control', precision_at_k: '0.7', recall_at_k: '0.6', ndcg_at_k: '0.65', mrr: '0.5', sample_size: 100 },
        { strategy_name: 'treatment', precision_at_k: '0.8', recall_at_k: '0.7', ndcg_at_k: '0.75', mrr: '0.6', sample_size: 100 },
      ];
      sql = makeSql(rows);
      evaluator = new SearchQualityEvaluator(sql);
      const result = await evaluator.getResults('exp-1');
      expect(result.isOk()).toBe(true);
      const results = result._unsafeUnwrap();
      expect(results).toHaveLength(2);
      expect(results[0]!.strategyName).toBe('control');
      expect(results[1]!.metrics.ndcgAtK).toBe(0.75);
    });
  });

  describe('promoteExperiment()', () => {
    it('returns promoted experiment', async () => {
      sql = makeSql([{ ...experimentRow, status: 'promoted', winner: 'hybrid', traffic_pct: 100 }]);
      evaluator = new SearchQualityEvaluator(sql);
      const result = await evaluator.promoteExperiment(WORKSPACE, 'exp-1', 'hybrid');
      expect(result.isOk()).toBe(true);
      const exp = result._unsafeUnwrap();
      expect(exp.status).toBe('promoted');
      expect(exp.winner).toBe('hybrid');
      expect(exp.trafficPct).toBe(100);
    });

    it('returns err when experiment not found or not running', async () => {
      sql = makeSql([]);
      evaluator = new SearchQualityEvaluator(sql);
      const result = await evaluator.promoteExperiment(WORKSPACE, 'exp-1', 'hybrid');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listExperiments()', () => {
    it('returns all experiments', async () => {
      sql = makeSql([experimentRow, { ...experimentRow, id: 'exp-2', status: 'promoted' }]);
      evaluator = new SearchQualityEvaluator(sql);
      const result = await evaluator.listExperiments(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('filters by status when provided', async () => {
      sql = makeSql([experimentRow]);
      evaluator = new SearchQualityEvaluator(sql);
      const result = await evaluator.listExperiments(WORKSPACE, 'running');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });
  });
});
