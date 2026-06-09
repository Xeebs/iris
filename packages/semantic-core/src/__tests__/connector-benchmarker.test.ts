import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectorBenchmarker } from '../connector-benchmarker.js';
import type { BenchmarkMetrics, BenchmarkBaseline } from '../connector-benchmarker.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (arr: unknown) => arr;
  (fn as Record<string, unknown>).json = (obj: unknown) => obj;
  return fn;
}

function makeMetrics(overrides: Partial<BenchmarkMetrics> = {}): BenchmarkMetrics {
  return {
    connectorId: 'hubspot',
    entityType: 'contact',
    dataSize: 1000,
    durationMs: 500,
    throughputPerSec: 2000,
    memoryPeakMb: 50,
    apiCallCount: 10,
    errorRate: 0,
    avgTransformMs: 0.5,
    runAt: new Date(),
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<BenchmarkBaseline> = {}): BenchmarkBaseline {
  return {
    connectorId: 'hubspot',
    entityType: 'contact',
    baselineThroughput: 2000,
    baselineMemoryMb: 50,
    measuredAt: new Date(),
    ...overrides,
  };
}

async function* makeGenerator(count: number, nullAt?: number) {
  for (let i = 0; i < count; i++) {
    if (nullAt !== undefined && i === nullAt) {
      yield null;
    } else {
      yield { id: `entity-${i}`, type: 'contact', label: `Contact ${i}`, attributes: { index: i } };
    }
  }
}

// ─── executeBenchmark ─────────────────────────────────────────────────────────

describe('ConnectorBenchmarker.executeBenchmark', () => {
  it('returns metrics with correct connectorId and entityType', async () => {
    const benchmarker = new ConnectorBenchmarker(makeSql());
    const metrics = await benchmarker.executeBenchmark('sf', 'deal', () => makeGenerator(20), { dataSize: 1000 });
    expect(metrics.connectorId).toBe('sf');
    expect(metrics.entityType).toBe('deal');
  });

  it('measures throughputPerSec > 0', async () => {
    const benchmarker = new ConnectorBenchmarker(makeSql());
    const metrics = await benchmarker.executeBenchmark('hubspot', 'contact', () => makeGenerator(20), { dataSize: 1000 });
    expect(metrics.throughputPerSec).toBeGreaterThan(0);
  });

  it('records the correct dataSize', async () => {
    const benchmarker = new ConnectorBenchmarker(makeSql());
    const metrics = await benchmarker.executeBenchmark('hubspot', 'contact', () => makeGenerator(20), { dataSize: 1000 });
    expect(metrics.dataSize).toBe(1000);
  });

  it('returns durationMs >= 0', async () => {
    const benchmarker = new ConnectorBenchmarker(makeSql());
    const metrics = await benchmarker.executeBenchmark('sf', 'deal', () => makeGenerator(20), { dataSize: 1000 });
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('counts null entities as errors', async () => {
    const benchmarker = new ConnectorBenchmarker(makeSql());
    const metrics = await benchmarker.executeBenchmark('sf', 'contact', () => makeGenerator(10, 5), { dataSize: 1000, warmupRuns: 0 });
    expect(metrics.errorRate).toBeGreaterThan(0);
  });

  it('sets runAt to a recent date', async () => {
    const before = Date.now();
    const benchmarker = new ConnectorBenchmarker(makeSql());
    const metrics = await benchmarker.executeBenchmark('sf', 'deal', () => makeGenerator(10), { dataSize: 1000 });
    expect(metrics.runAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('persists result to SQL', async () => {
    const sql = makeSql();
    const benchmarker = new ConnectorBenchmarker(sql);
    await benchmarker.executeBenchmark('hubspot', 'contact', () => makeGenerator(10), { dataSize: 1000, warmupRuns: 0 });
    expect(sql).toHaveBeenCalled();
  });
});

// ─── compareConnectors ────────────────────────────────────────────────────────

describe('ConnectorBenchmarker.compareConnectors', () => {
  let benchmarker: ConnectorBenchmarker;
  beforeEach(() => { benchmarker = new ConnectorBenchmarker(makeSql()); });

  it('returns rankings with fastest, lowestMemory, mostReliable', () => {
    const results = [
      makeMetrics({ connectorId: 'hubspot', throughputPerSec: 3000, memoryPeakMb: 80, errorRate: 0.01 }),
      makeMetrics({ connectorId: 'salesforce', throughputPerSec: 1500, memoryPeakMb: 40, errorRate: 0 }),
    ];
    const comparison = benchmarker.compareConnectors(results);
    expect(comparison.rankings.fastest).toBe('hubspot');
    expect(comparison.rankings.lowestMemory).toBe('salesforce');
    expect(comparison.rankings.mostReliable).toBe('salesforce');
  });

  it('sorts results by throughput descending', () => {
    const results = [
      makeMetrics({ connectorId: 'a', throughputPerSec: 1000 }),
      makeMetrics({ connectorId: 'b', throughputPerSec: 3000 }),
      makeMetrics({ connectorId: 'c', throughputPerSec: 2000 }),
    ];
    const comparison = benchmarker.compareConnectors(results);
    expect(comparison.results[0]!.connectorId).toBe('b');
    expect(comparison.results[1]!.connectorId).toBe('c');
    expect(comparison.results[2]!.connectorId).toBe('a');
  });

  it('includes connectorIds list', () => {
    const results = [makeMetrics({ connectorId: 'a' }), makeMetrics({ connectorId: 'b' })];
    const comparison = benchmarker.compareConnectors(results);
    expect(comparison.connectorIds).toContain('a');
    expect(comparison.connectorIds).toContain('b');
  });

  it('throws when given empty results', () => {
    expect(() => benchmarker.compareConnectors([])).toThrow();
  });
});

// ─── detectPerformanceRegression ─────────────────────────────────────────────

describe('ConnectorBenchmarker.detectPerformanceRegression', () => {
  let benchmarker: ConnectorBenchmarker;
  beforeEach(() => { benchmarker = new ConnectorBenchmarker(makeSql()); });

  it('detects throughput regression > 10%', () => {
    const current = makeMetrics({ throughputPerSec: 1700 });
    const baseline = makeBaseline({ baselineThroughput: 2000, baselineMemoryMb: 50 });
    const report = benchmarker.detectPerformanceRegression('hubspot', 'contact', current, baseline);
    expect(report.hasRegression).toBe(true);
    expect(report.throughputDeltaPct).toBeLessThan(-10);
  });

  it('does not flag regression for < 10% change', () => {
    const current = makeMetrics({ throughputPerSec: 1950, memoryPeakMb: 51 });
    const baseline = makeBaseline({ baselineThroughput: 2000, baselineMemoryMb: 50 });
    const report = benchmarker.detectPerformanceRegression('hubspot', 'contact', current, baseline);
    expect(report.hasRegression).toBe(false);
  });

  it('detects memory regression > 10%', () => {
    const current = makeMetrics({ throughputPerSec: 2000, memoryPeakMb: 60 });
    const baseline = makeBaseline({ baselineThroughput: 2000, baselineMemoryMb: 50 });
    const report = benchmarker.detectPerformanceRegression('hubspot', 'contact', current, baseline);
    expect(report.hasRegression).toBe(true);
    expect(report.memoryDeltaPct).toBeGreaterThan(10);
  });

  it('returns details string describing the regression', () => {
    const current = makeMetrics({ throughputPerSec: 1000 });
    const baseline = makeBaseline({ baselineThroughput: 2000, baselineMemoryMb: 50 });
    const report = benchmarker.detectPerformanceRegression('hubspot', 'contact', current, baseline);
    expect(typeof report.details).toBe('string');
    expect(report.details.length).toBeGreaterThan(0);
  });

  it('returns stable message when no regression', () => {
    const current = makeMetrics({ throughputPerSec: 2000, memoryPeakMb: 48 });
    const baseline = makeBaseline({ baselineThroughput: 2000, baselineMemoryMb: 50 });
    const report = benchmarker.detectPerformanceRegression('hubspot', 'contact', current, baseline);
    expect(report.details).toContain('within');
  });
});

// ─── getResults & getBenchmarkMatrix ─────────────────────────────────────────

describe('ConnectorBenchmarker.getResults', () => {
  it('returns empty array on DB error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('DB offline')) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;
    const benchmarker = new ConnectorBenchmarker(sql);
    const results = await benchmarker.getResults('hubspot');
    expect(results).toEqual([]);
  });

  it('passes entityType filter to SQL', async () => {
    const sql = makeSql([]);
    const benchmarker = new ConnectorBenchmarker(sql);
    await benchmarker.getResults('hubspot', 'contact', 10);
    expect(sql).toHaveBeenCalled();
  });
});

describe('ConnectorBenchmarker.getBenchmarkMatrix', () => {
  it('returns matrix with correct shape', async () => {
    const sql = makeSql([]);
    const benchmarker = new ConnectorBenchmarker(sql);
    const matrix = await benchmarker.getBenchmarkMatrix(['hubspot', 'sf'], ['contact', 'deal']);
    expect(matrix).toHaveProperty('contact');
    expect(matrix).toHaveProperty('deal');
    expect(matrix['contact']).toHaveProperty('hubspot');
    expect(matrix['contact']).toHaveProperty('sf');
  });

  it('returns null for connectors with no data', async () => {
    const sql = makeSql([]);
    const benchmarker = new ConnectorBenchmarker(sql);
    const matrix = await benchmarker.getBenchmarkMatrix(['unknown'], ['contact']);
    expect(matrix['contact']!['unknown']).toBeNull();
  });
});
