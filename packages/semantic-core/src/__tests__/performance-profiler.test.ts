import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerformanceProfiler } from '../performance-profiler.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  return vi.fn(async () => rows);
}

function makeService(sql: ReturnType<typeof vi.fn>) {
  return new PerformanceProfiler(sql as unknown as ConstructorParameters<typeof PerformanceProfiler>[0]);
}

const SAMPLE_ROWS = [
  { operation: 'connector_sync', connector_id: 'conn-1', workspace_id: 'ws-1', duration_ms: 100 },
  { operation: 'connector_sync', connector_id: 'conn-1', workspace_id: 'ws-1', duration_ms: 200 },
  { operation: 'connector_sync', connector_id: 'conn-1', workspace_id: 'ws-1', duration_ms: 300 },
  { operation: 'vector_search', connector_id: null, workspace_id: 'ws-1', duration_ms: 50 },
];

describe('PerformanceProfiler', () => {
  let sql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('record', () => {
    it('inserts a performance sample and returns ok', async () => {
      sql = makeSql();
      const svc = makeService(sql);
      const result = await svc.record('connector_sync', 123.4, true, 'ws-1', 'conn-1');
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalled();
    });

    it('returns ok even when sql throws (non-fatal)', async () => {
      sql = vi.fn().mockRejectedValue(new Error('insert failed'));
      const svc = makeService(sql);
      const result = await svc.record('vector_search', 50, false);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns stats grouped by operation', async () => {
      sql = makeSql(SAMPLE_ROWS);
      const svc = makeService(sql);
      const result = await svc.getStats('ws-1');
      expect(result.isOk()).toBe(true);
      const stats = result._unsafeUnwrap();
      expect(stats.length).toBeGreaterThan(0);
      const syncStat = stats.find((s) => s.operation === 'connector_sync');
      expect(syncStat).toBeDefined();
      expect(syncStat!.percentiles.count).toBe(3);
      expect(syncStat!.percentiles.min).toBe(100);
      expect(syncStat!.percentiles.max).toBe(300);
    });

    it('returns empty array when no samples', async () => {
      sql = makeSql([]);
      const svc = makeService(sql);
      const result = await svc.getStats();
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error'));
      const svc = makeService(sql);
      const result = await svc.getStats('ws-1');
      expect(result.isErr()).toBe(true);
    });

    it('computes correct percentiles for sorted durations', async () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({
        operation: 'vector_search',
        connector_id: null,
        workspace_id: 'ws-1',
        duration_ms: i + 1,
      }));
      sql = makeSql(rows);
      const svc = makeService(sql);
      const result = await svc.getStats('ws-1');
      const stat = result._unsafeUnwrap()[0]!;
      expect(stat.percentiles.p50).toBe(50);
      expect(stat.percentiles.p95).toBe(95);
      expect(stat.percentiles.p99).toBe(99);
    });
  });

  describe('getConnectorBreakdown', () => {
    it('returns connector p95 latencies', async () => {
      sql = makeSql([
        { connector_id: 'conn-1', p95_ms: 250, sample_count: 100 },
        { connector_id: 'conn-2', p95_ms: 80, sample_count: 50 },
      ]);
      const svc = makeService(sql);
      const result = await svc.getConnectorBreakdown('ws-1');
      expect(result.isOk()).toBe(true);
      const breakdown = result._unsafeUnwrap();
      expect(breakdown[0]!.connectorId).toBe('conn-1');
      expect(breakdown[0]!.p95Ms).toBe(250);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error'));
      const svc = makeService(sql);
      const result = await svc.getConnectorBreakdown('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('formatPrometheus', () => {
    it('produces valid prometheus text with gauge and counter lines', async () => {
      sql = makeSql(SAMPLE_ROWS);
      const svc = makeService(sql);
      const result = await svc.formatPrometheus('ws-1');
      expect(result.isOk()).toBe(true);
      const text = result._unsafeUnwrap();
      expect(text).toContain('# HELP iris_operation_duration_ms');
      expect(text).toContain('# TYPE iris_operation_duration_ms gauge');
      expect(text).toContain('quantile="0.95"');
      expect(text).toContain('# TYPE iris_operation_total counter');
    });

    it('returns err when getStats fails', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error'));
      const svc = makeService(sql);
      const result = await svc.formatPrometheus();
      expect(result.isErr()).toBe(true);
    });
  });

  describe('pruneOldSamples', () => {
    it('runs without throwing (non-fatal)', async () => {
      sql = makeSql([]);
      const svc = makeService(sql);
      await expect(svc.pruneOldSamples()).resolves.toBeUndefined();
    });
  });
});
