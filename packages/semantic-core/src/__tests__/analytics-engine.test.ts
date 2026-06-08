import { describe, it, expect, vi } from 'vitest';
import {
  computeAggregates,
  exponentialMovingAverage,
  detectAnomalies,
  bucketTimestamp,
  buildDashboardView,
  AnalyticsService,
} from '../analytics-engine.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── computeAggregates ────────────────────────────────────────────────────────

describe('computeAggregates', () => {
  it('returns zeros for empty array', () => {
    const r = computeAggregates([]);
    expect(r.p50).toBe(0);
    expect(r.mean).toBe(0);
    expect(r.stddev).toBe(0);
  });

  it('computes correct percentiles for sorted values', () => {
    // 10 values: 1..10; floor(10*50/100)=5 → sortedValues[5]=6
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r = computeAggregates(vals);
    expect(r.p50).toBe(6);
    expect(r.p95).toBe(10); // floor(10*95/100)=9 → index 9 = 10
    expect(r.mean).toBe(5.5);
    expect(r.stddev).toBeGreaterThan(0);
  });

  it('computes zero stddev for single value', () => {
    const r = computeAggregates([42]);
    expect(r.mean).toBe(42);
    expect(r.stddev).toBe(0);
    expect(r.p50).toBe(42);
  });

  it('computes mean correctly', () => {
    const r = computeAggregates([2, 4, 6]);
    expect(r.mean).toBeCloseTo(4, 5);
  });

  it('computes stddev correctly for [2,4,6]', () => {
    const r = computeAggregates([2, 4, 6]);
    // variance = ((2-4)^2 + (4-4)^2 + (6-4)^2) / 3 = 8/3
    expect(r.stddev).toBeCloseTo(Math.sqrt(8 / 3), 5);
  });
});

// ─── exponentialMovingAverage ─────────────────────────────────────────────────

describe('exponentialMovingAverage', () => {
  it('returns empty for empty input', () => {
    expect(exponentialMovingAverage([])).toEqual([]);
  });

  it('returns same value for single element', () => {
    expect(exponentialMovingAverage([5])).toEqual([5]);
  });

  it('first EMA value equals first input', () => {
    const ema = exponentialMovingAverage([10, 20, 30]);
    expect(ema[0]).toBe(10);
  });

  it('EMA values are between first and last values', () => {
    const ema = exponentialMovingAverage([0, 100], 0.5);
    expect(ema[1]).toBe(50);
  });

  it('higher alpha reacts faster to changes', () => {
    const emaHigh = exponentialMovingAverage([0, 100], 0.9);
    const emaLow = exponentialMovingAverage([0, 100], 0.1);
    expect(emaHigh[1]!).toBeGreaterThan(emaLow[1]!);
  });
});

// ─── detectAnomalies ─────────────────────────────────────────────────────────

describe('detectAnomalies', () => {
  it('returns empty for fewer than 3 values', () => {
    expect(detectAnomalies([1, 2])).toEqual([]);
    expect(detectAnomalies([])).toEqual([]);
  });

  it('flags a clear outlier', () => {
    const values = [10, 10, 10, 10, 10, 10, 200];
    const results = detectAnomalies(values, 2.0);
    const anomalies = results.filter((r) => r.isAnomaly);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies.some((r) => r.value === 200)).toBe(true);
  });

  it('does not flag values within threshold', () => {
    const values = [10, 11, 10, 12, 10, 11, 10];
    const results = detectAnomalies(values, 3.0);
    expect(results.every((r) => !r.isAnomaly)).toBe(true);
  });

  it('returns one result per input value', () => {
    const values = [1, 2, 3, 4, 5];
    expect(detectAnomalies(values)).toHaveLength(5);
  });

  it('each result has zScore >= 0', () => {
    const values = [1, 2, 3, 4, 5];
    detectAnomalies(values).forEach((r) => expect(r.zScore).toBeGreaterThanOrEqual(0));
  });
});

// ─── bucketTimestamp ──────────────────────────────────────────────────────────

describe('bucketTimestamp', () => {
  it('buckets 1h correctly (zero out minutes/seconds)', () => {
    const ts = new Date('2026-06-08T15:35:22Z');
    const bucket = bucketTimestamp(ts, '1h');
    expect(bucket).toContain('T15:00:00');
  });

  it('buckets 1d correctly (zeroes minutes and seconds)', () => {
    const ts = new Date('2026-06-08T15:35:22Z');
    const bucket = bucketTimestamp(ts, '1d');
    const d = new Date(bucket);
    // Minutes and seconds are zero regardless of local timezone
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('buckets 1w to Monday', () => {
    // 2026-06-08 is a Monday
    const ts = new Date('2026-06-10T12:00:00Z'); // Wednesday
    const bucket = bucketTimestamp(ts, '1w');
    const d = new Date(bucket);
    expect(d.getDay()).toBe(1); // Monday
  });

  it('returns a valid ISO string', () => {
    const ts = new Date('2026-06-08T10:00:00Z');
    const bucket = bucketTimestamp(ts, '1h');
    expect(() => new Date(bucket)).not.toThrow();
  });
});

// ─── buildDashboardView ───────────────────────────────────────────────────────

describe('buildDashboardView', () => {
  const mockAgg = (name: string): import('../analytics-engine.js').MetricAggregate => ({
    metricName: name,
    window: '1d',
    dimensions: {},
    p50: 50,
    p95: 95,
    p99: 99,
    mean: 55,
    stddev: 10,
    count: 100,
    computedAt: new Date(),
  });

  it('token-efficiency template returns avgTokenSavedPct', () => {
    const view = buildDashboardView('token-efficiency', [mockAgg('tokens_saved')]);
    expect(view).toHaveProperty('avgTokenSavedPct');
    expect(view).toHaveProperty('aggregates');
  });

  it('connector-health template returns avgErrorRate', () => {
    const view = buildDashboardView('connector-health', [mockAgg('connector_error')]);
    expect(view).toHaveProperty('avgErrorRate');
  });

  it('user-adoption template returns totalQueries', () => {
    const view = buildDashboardView('user-adoption', [mockAgg('query_latency')]);
    expect(view).toHaveProperty('totalQueries');
  });

  it('cost-trends template returns tokenCosts', () => {
    const view = buildDashboardView('cost-trends', [mockAgg('tokens_used'), mockAgg('cache_hit')]);
    expect(view).toHaveProperty('tokenCosts');
    expect(view).toHaveProperty('cacheHits');
  });

  it('returns template name in view', () => {
    const view = buildDashboardView('token-efficiency', []);
    expect(view['template']).toBe('token-efficiency');
  });
});

// ─── AnalyticsService ─────────────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('AnalyticsService.recordMetricEvent', () => {
  it('returns ok on success', async () => {
    const sql = makeSql([]);
    const svc = new AnalyticsService(sql);
    const result = await svc.recordMetricEvent('query_latency', 120, { connector: 'hubspot' }, 'ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().name).toBe('query_latency');
    expect(result._unsafeUnwrap().value).toBe(120);
  });

  it('returns err on db failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db down')) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new AnalyticsService(sql);
    const result = await svc.recordMetricEvent('query_latency', 120, {}, 'ws-1');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('db down');
  });
});

describe('AnalyticsService.aggregateMetrics', () => {
  it('returns aggregate with zero stats for empty data', async () => {
    const sql = makeSql([]);
    const svc = new AnalyticsService(sql);
    const result = await svc.aggregateMetrics('query_latency', '1d', 'ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().count).toBe(0);
    expect(result._unsafeUnwrap().mean).toBe(0);
  });

  it('returns computed aggregates for sample data', async () => {
    const sql = makeSql([{ value: 10 }, { value: 20 }, { value: 30 }]);
    const svc = new AnalyticsService(sql);
    const result = await svc.aggregateMetrics('query_latency', '1h', 'ws-1');
    expect(result._unsafeUnwrap().count).toBe(3);
    expect(result._unsafeUnwrap().mean).toBeCloseTo(20, 5);
  });
});

describe('AnalyticsService.detectMetricAnomalies', () => {
  it('returns empty for no data', async () => {
    const sql = makeSql([]);
    const svc = new AnalyticsService(sql);
    const result = await svc.detectMetricAnomalies('query_latency', 'ws-1');
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('returns anomaly results for data', async () => {
    // Enough homogeneous values to make the outlier statistically obvious
    const rows = [
      ...Array.from({ length: 10 }, () => ({ value: 10, timestamp: new Date() })),
      { value: 1000, timestamp: new Date() },
    ];
    const sql = makeSql(rows);
    const svc = new AnalyticsService(sql);
    const result = await svc.detectMetricAnomalies('query_latency', 'ws-1', 24, 2.0);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().some((r) => r.isAnomaly)).toBe(true);
  });
});

describe('AnalyticsService.rollupOldData', () => {
  it('returns 0 when no old data', async () => {
    const sql = makeSql([]);
    const svc = new AnalyticsService(sql);
    const result = await svc.rollupOldData();
    expect(result._unsafeUnwrap()).toBe(0);
  });

  it('returns count of rolled-up events', async () => {
    let callCount = 0;
    const sql = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([
        { name: 'query_latency', workspace_id: 'ws-1', value: 100 },
        { name: 'query_latency', workspace_id: 'ws-1', value: 200 },
      ]);
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new AnalyticsService(sql);
    const result = await svc.rollupOldData();
    expect(result._unsafeUnwrap()).toBe(2);
  });
});

describe('AnalyticsService.getDashboard', () => {
  it('returns a dashboard view', async () => {
    const sql = makeSql([]);
    const svc = new AnalyticsService(sql);
    const result = await svc.getDashboard('token-efficiency', 'ws-1', '1d');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()['template']).toBe('token-efficiency');
  });
});
