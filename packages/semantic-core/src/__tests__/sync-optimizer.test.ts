import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  percentile,
  linearRegression,
  predictOptimalBatchSize,
  computeRecommendedParallelism,
  detectBottleneck,
  SyncOptimizer,
} from '../sync-optimizer.js';
import { ok, err } from 'neverthrow';

// ─── percentile ────────────────────────────────────────────────────────────────

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('returns the only element for single-element array', () => {
    expect(percentile([42], 0.5)).toBe(42);
  });

  it('computes p50 correctly', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 0.5)).toBe(30);
  });

  it('computes p95 on larger array', () => {
    // idx = 0.95 * 99 = 94.05 → interpolate between sorted[94]=95 and sorted[95]=96
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 0.95)).toBeCloseTo(95.05, 1);
  });

  it('returns near-max for p99 on small array', () => {
    // idx = 0.99 * 2 = 1.98 → interpolate: 200 + (300-200)*0.98 = 298
    const sorted = [100, 200, 300];
    expect(percentile(sorted, 0.99)).toBeCloseTo(298, 0);
  });
});

// ─── linearRegression ─────────────────────────────────────────────────────────

describe('linearRegression', () => {
  it('returns zero slope/intercept for fewer than 2 points', () => {
    const r = linearRegression([[1, 1]]);
    expect(r.slope).toBe(0);
    expect(r.intercept).toBe(0);
  });

  it('fits a perfect linear relationship', () => {
    const points: [number, number][] = [[1, 2], [2, 4], [3, 6], [4, 8]];
    const r = linearRegression(points);
    expect(r.slope).toBeCloseTo(2, 5);
    expect(r.intercept).toBeCloseTo(0, 5);
  });

  it('handles vertical collapse (all same x)', () => {
    const points: [number, number][] = [[5, 10], [5, 20], [5, 30]];
    const r = linearRegression(points);
    expect(r.slope).toBe(0);
    expect(r.intercept).toBeCloseTo(20, 1); // mean of y
  });
});

// ─── predictOptimalBatchSize ──────────────────────────────────────────────────

describe('predictOptimalBatchSize', () => {
  it('returns default batch size with low confidence for < 3 rows', () => {
    const r = predictOptimalBatchSize([{ batch_size: 50, duration_ms: 1000, entity_count: 50 }], 300_000);
    expect(r.recommendedBatchSize).toBe(100);
    expect(r.confidence).toBe('low');
  });

  it('returns low confidence with exactly 3 rows', () => {
    const rows = [
      { batch_size: 50, duration_ms: 5000, entity_count: 50 },
      { batch_size: 100, duration_ms: 10000, entity_count: 100 },
      { batch_size: 150, duration_ms: 15000, entity_count: 150 },
    ];
    const r = predictOptimalBatchSize(rows, 300_000);
    expect(r.confidence).toBe('low');
    expect(r.recommendedBatchSize).toBeGreaterThan(0);
    expect(r.recommendedBatchSize).toBeLessThanOrEqual(1000);
  });

  it('returns medium confidence with 5-9 rows', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      batch_size: (i + 1) * 50,
      duration_ms: (i + 1) * 5000,
      entity_count: (i + 1) * 50,
    }));
    const r = predictOptimalBatchSize(rows, 300_000);
    expect(r.confidence).toBe('medium');
  });

  it('returns high confidence with 10+ rows', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      batch_size: (i + 1) * 10,
      duration_ms: (i + 1) * 1000,
      entity_count: (i + 1) * 10,
    }));
    const r = predictOptimalBatchSize(rows, 300_000);
    expect(r.confidence).toBe('high');
  });

  it('clamps recommended batch size to [10, 1000]', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      batch_size: (i + 1) * 10,
      duration_ms: (i + 1) * 100,
      entity_count: (i + 1) * 10,
    }));
    const r = predictOptimalBatchSize(rows, 1);
    expect(r.recommendedBatchSize).toBeGreaterThanOrEqual(10);
    expect(r.recommendedBatchSize).toBeLessThanOrEqual(1000);
  });
});

// ─── computeRecommendedParallelism ────────────────────────────────────────────

describe('computeRecommendedParallelism', () => {
  it('returns 1 for empty rows', () => {
    expect(computeRecommendedParallelism([], 4).recommendedParallelism).toBe(1);
    expect(computeRecommendedParallelism([], 4).rateLimitedFraction).toBe(0);
  });

  it('returns cpuCount when no rate limiting', () => {
    const rows = Array.from({ length: 10 }, () => ({ rate_limited: false, api_calls: 5 }));
    const r = computeRecommendedParallelism(rows, 4);
    expect(r.recommendedParallelism).toBe(4);
    expect(r.rateLimitedFraction).toBe(0);
  });

  it('reduces parallelism when heavily rate limited', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ rate_limited: i < 8, api_calls: 5 }));
    const r = computeRecommendedParallelism(rows, 4);
    expect(r.rateLimitedFraction).toBeCloseTo(0.8, 1);
    expect(r.recommendedParallelism).toBe(1);
  });

  it('caps parallelism at 8', () => {
    const rows = Array.from({ length: 10 }, () => ({ rate_limited: false, api_calls: 1 }));
    const r = computeRecommendedParallelism(rows, 16);
    expect(r.recommendedParallelism).toBeLessThanOrEqual(8);
  });
});

// ─── detectBottleneck ─────────────────────────────────────────────────────────

describe('detectBottleneck', () => {
  it('returns unknown for empty rows', () => {
    expect(detectBottleneck([])).toBe('unknown');
  });

  it('identifies api_rate_limit when >30% syncs are rate limited', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      rate_limited: i < 4,
      api_calls: 10,
      duration_ms: 1000,
      batch_size: 100,
    }));
    expect(detectBottleneck(rows)).toBe('api_rate_limit');
  });

  it('identifies processing_time when high ms/entity and low api calls', () => {
    const rows = Array.from({ length: 10 }, () => ({
      rate_limited: false,
      api_calls: 1,
      duration_ms: 10000,
      batch_size: 100,
    }));
    expect(detectBottleneck(rows)).toBe('processing_time');
  });
});

// ─── SyncOptimizer class ──────────────────────────────────────────────────────

function makeSqlMock(returnValue: unknown = []) {
  const fn = vi.fn().mockResolvedValue(returnValue);
  return fn as unknown as Parameters<typeof SyncOptimizer.prototype.logSyncMetric>[0] extends never
    ? never
    : (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

describe('SyncOptimizer.logSyncMetric', () => {
  it('returns ok on successful insert', async () => {
    const sql = makeSqlMock([]);
    const optimizer = new SyncOptimizer(sql as unknown as Parameters<typeof SyncOptimizer>[0]);
    const result = await optimizer.logSyncMetric({
      connector_id: 'c1', sync_id: 's1', workspace_id: 'w1',
      batch_size: 100, entity_count: 95, token_count: 5000,
      duration_ms: 2000, api_calls: 10, rate_limited: false, error_count: 0,
    });
    expect(result.isOk()).toBe(true);
  });

  it('returns err on SQL failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('DB down'));
    const optimizer = new SyncOptimizer(sql as unknown as Parameters<typeof SyncOptimizer>[0]);
    const result = await optimizer.logSyncMetric({
      connector_id: 'c1', sync_id: 's1', workspace_id: 'w1',
      batch_size: 100, entity_count: 95, token_count: 5000,
      duration_ms: 2000, api_calls: 10, rate_limited: false, error_count: 0,
    });
    expect(result.isErr()).toBe(true);
  });
});

describe('SyncOptimizer.analyzeHistoricalSyncMetrics', () => {
  it('returns zero stats when no rows', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const optimizer = new SyncOptimizer(sql as unknown as Parameters<typeof SyncOptimizer>[0]);
    const result = await optimizer.analyzeHistoricalSyncMetrics('c1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalSyncs).toBe(0);
    expect(result._unsafeUnwrap().p50Ms).toBe(0);
  });

  it('computes correct percentiles from rows', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      duration_ms: (i + 1) * 100,
      entity_throughput: 10,
      token_throughput: 500,
      error_count: 0,
    }));
    const sql = vi.fn().mockResolvedValue(rows);
    const optimizer = new SyncOptimizer(sql as unknown as Parameters<typeof SyncOptimizer>[0]);
    const result = await optimizer.analyzeHistoricalSyncMetrics('c1');
    expect(result.isOk()).toBe(true);
    const stats = result._unsafeUnwrap();
    expect(stats.totalSyncs).toBe(100);
    expect(stats.p50Ms).toBeGreaterThan(4000);
    expect(stats.p95Ms).toBeGreaterThan(9000);
    expect(stats.failureRate).toBe(0);
  });
});

describe('SyncOptimizer.recommendOptimalBatchSize', () => {
  it('returns default batch size when no history', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const optimizer = new SyncOptimizer(sql as unknown as Parameters<typeof SyncOptimizer>[0]);
    const result = await optimizer.recommendOptimalBatchSize('c1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().recommendedBatchSize).toBe(100);
  });

  it('returns recommendation from historical data', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      batch_size: (i + 1) * 50,
      duration_ms: (i + 1) * 5000,
      entity_count: (i + 1) * 50,
    }));
    const sql = vi.fn().mockResolvedValue(rows);
    const optimizer = new SyncOptimizer(sql as unknown as Parameters<typeof SyncOptimizer>[0]);
    const result = await optimizer.recommendOptimalBatchSize('c1', 300_000);
    expect(result.isOk()).toBe(true);
    const rec = result._unsafeUnwrap();
    expect(rec.recommendedBatchSize).toBeGreaterThan(0);
    expect(rec.recommendedBatchSize).toBeLessThanOrEqual(1000);
  });
});

describe('SyncOptimizer.recommendParallelism', () => {
  it('returns parallelism 1 when rate limited >50%', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ rate_limited: i < 7, api_calls: 5 }));
    const sql = vi.fn().mockResolvedValue(rows);
    const optimizer = new SyncOptimizer(sql as unknown as Parameters<typeof SyncOptimizer>[0]);
    const result = await optimizer.recommendParallelism('c1', 4);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().recommendedParallelism).toBe(1);
  });
});
