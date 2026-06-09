import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SyncParallelismOptimizer,
  type HistoricalMetrics,
  type OptimizationConfig,
  type ExperimentVariant,
} from '../sync-parallelism-optimizer.js';

function makeSql(overrides: Record<string, unknown[]> = {}) {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.raw.join('?');
    for (const [key, rows] of Object.entries(overrides)) {
      if (query.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
}

const makeMetrics = (overrides: Partial<HistoricalMetrics> = {}): HistoricalMetrics => ({
  concurrency: 5,
  throughputPerSec: 50,
  p95LatencyMs: 1200,
  errorRate: 0.01,
  entityCount: 1000,
  durationMs: 20000,
  ...overrides,
});

describe('SyncParallelismOptimizer', () => {
  let sql: ReturnType<typeof makeSql>;
  let optimizer: SyncParallelismOptimizer;

  beforeEach(() => {
    sql = makeSql();
    optimizer = new SyncParallelismOptimizer(sql as unknown as ReturnType<typeof import('postgres').default>);
  });

  describe('recommendConcurrency', () => {
    it('returns safe default when no historical metrics are provided', async () => {
      const result = await optimizer.recommendConcurrency('conn1', 'contact', []);
      expect(result.recommended).toBe(5);
      expect(result.confidenceScore).toBeLessThan(0.5);
    });

    it('recommends hill-climbing up when higher concurrency improves throughput', async () => {
      const metrics: HistoricalMetrics[] = [
        makeMetrics({ concurrency: 5, throughputPerSec: 50 }),
        makeMetrics({ concurrency: 7, throughputPerSec: 70 }),
        makeMetrics({ concurrency: 9, throughputPerSec: 90 }),
      ];
      const result = await optimizer.recommendConcurrency('conn1', 'contact', metrics);
      expect(result.recommended).toBeGreaterThanOrEqual(9);
    });

    it('excludes metrics where p95 latency exceeds threshold', async () => {
      const metrics: HistoricalMetrics[] = [
        makeMetrics({ concurrency: 5, throughputPerSec: 50, p95LatencyMs: 1000 }),
        makeMetrics({ concurrency: 10, throughputPerSec: 150, p95LatencyMs: 8000 }),
      ];
      const result = await optimizer.recommendConcurrency('conn1', 'contact', metrics);
      expect(result.recommended).toBeLessThan(10);
    });

    it('excludes metrics with high error rate', async () => {
      const metrics: HistoricalMetrics[] = [
        makeMetrics({ concurrency: 5, throughputPerSec: 50, errorRate: 0.01 }),
        makeMetrics({ concurrency: 15, throughputPerSec: 200, errorRate: 0.15 }),
      ];
      const result = await optimizer.recommendConcurrency('conn1', 'contact', metrics);
      expect(result.recommended).toBeLessThanOrEqual(7);
    });

    it('backs off to half-best when all metrics exceed thresholds', async () => {
      const metrics: HistoricalMetrics[] = [
        makeMetrics({ concurrency: 10, errorRate: 0.3, p95LatencyMs: 9000 }),
        makeMetrics({ concurrency: 5, errorRate: 0.1, p95LatencyMs: 3000 }),
      ];
      const result = await optimizer.recommendConcurrency('conn1', 'contact', metrics);
      expect(result.recommended).toBeLessThanOrEqual(5);
    });

    it('caps recommendation at MAX_CONCURRENCY (20)', async () => {
      const metrics: HistoricalMetrics[] = Array.from({ length: 5 }, (_, i) =>
        makeMetrics({ concurrency: (i + 1) * 4, throughputPerSec: (i + 1) * 100, p95LatencyMs: 500 })
      );
      const result = await optimizer.recommendConcurrency('conn1', 'contact', metrics);
      expect(result.recommended).toBeLessThanOrEqual(20);
    });

    it('increases confidence score with more data points', async () => {
      const small = [makeMetrics()];
      const large = Array.from({ length: 8 }, (_, i) =>
        makeMetrics({ concurrency: i + 1, throughputPerSec: (i + 1) * 10 })
      );
      const r1 = await optimizer.recommendConcurrency('c', 't', small);
      const r2 = await optimizer.recommendConcurrency('c', 't', large);
      expect(r2.confidenceScore).toBeGreaterThan(r1.confidenceScore);
    });
  });

  describe('tuneRequestBatchSize', () => {
    it('halves batch size when error rate exceeds 20%', () => {
      const result = optimizer.tuneRequestBatchSize('conn1', 200, 0.25, 0);
      expect(result.recommendedBatch).toBe(100);
      expect(result.reason).toContain('High error rate');
    });

    it('reduces by 20% when error rate is between 5-20%', () => {
      const result = optimizer.tuneRequestBatchSize('conn1', 200, 0.10, 0);
      expect(result.recommendedBatch).toBe(160);
    });

    it('grows batch when error rate is below 1%', () => {
      const result = optimizer.tuneRequestBatchSize('conn1', 100, 0.005, 0);
      expect(result.recommendedBatch).toBeGreaterThan(100);
    });

    it('respects payload size cap when growing', () => {
      // 512KB / 60000B = 8 entities, but MIN_BATCH_SIZE=10 is the floor
      const result = optimizer.tuneRequestBatchSize('conn1', 100, 0.005, 60000);
      expect(result.recommendedBatch).toBeLessThanOrEqual(10);
    });

    it('never goes below MIN_BATCH_SIZE (10)', () => {
      const result = optimizer.tuneRequestBatchSize('conn1', 12, 0.5, 0);
      expect(result.recommendedBatch).toBeGreaterThanOrEqual(10);
    });

    it('never exceeds MAX_BATCH_SIZE (1000)', () => {
      const result = optimizer.tuneRequestBatchSize('conn1', 900, 0.0001, 10);
      expect(result.recommendedBatch).toBeLessThanOrEqual(1000);
    });

    it('keeps batch size unchanged when error rate is in safe range', () => {
      const result = optimizer.tuneRequestBatchSize('conn1', 200, 0.03, 0);
      expect(result.recommendedBatch).toBe(200);
    });
  });

  describe('allocateWorkerPool', () => {
    it('returns empty array when no connectors given', async () => {
      const result = await optimizer.allocateWorkerPool('ws1', [], 10);
      expect(result).toEqual([]);
    });

    it('allocates at least 1 worker per connector', async () => {
      sql = makeSql({
        sync_optimization_configs: [
          { connectorId: 'c1', workerWeight: 2.0 },
          { connectorId: 'c2', workerWeight: 1.0 },
          { connectorId: 'c3', workerWeight: 0.5 },
        ],
      });
      optimizer = new SyncParallelismOptimizer(sql as unknown as ReturnType<typeof import('postgres').default>);
      const result = await optimizer.allocateWorkerPool('ws1', ['c1', 'c2', 'c3'], 10);
      expect(result.every((r) => r.workers >= 1)).toBe(true);
    });

    it('distributes proportionally to weight', async () => {
      sql = makeSql({
        sync_optimization_configs: [
          { connectorId: 'heavy', workerWeight: 3.0 },
          { connectorId: 'light', workerWeight: 1.0 },
        ],
      });
      optimizer = new SyncParallelismOptimizer(sql as unknown as ReturnType<typeof import('postgres').default>);
      const result = await optimizer.allocateWorkerPool('ws1', ['heavy', 'light'], 8);
      const heavy = result.find((r) => r.connectorId === 'heavy')!;
      const light = result.find((r) => r.connectorId === 'light')!;
      expect(heavy.workers).toBeGreaterThan(light.workers);
    });

    it('uses default weight 1.0 for connectors not in config', async () => {
      const result = await optimizer.allocateWorkerPool('ws1', ['unknown1', 'unknown2'], 4);
      expect(result.length).toBe(2);
      expect(result.every((r) => r.weight === 1.0)).toBe(true);
    });
  });

  describe('executeOptimizationExperiment', () => {
    it('inserts experiment and returns ID', async () => {
      sql = makeSql({ optimization_experiments: [{ id: 'exp-uuid-123' }] });
      optimizer = new SyncParallelismOptimizer(sql as unknown as ReturnType<typeof import('postgres').default>);

      const variant: ExperimentVariant = {
        name: 'concurrency-8-test',
        concurrency: 8,
        batchSize: 150,
        trafficPct: 10,
      };
      const id = await optimizer.executeOptimizationExperiment('conn1', 'ws1', variant);
      expect(id).toBe('exp-uuid-123');
    });
  });

  describe('getConfigWithRecommendation', () => {
    it('returns defaults when no config exists', async () => {
      const result = await optimizer.getConfigWithRecommendation('conn1', 'ws1', []);
      expect(result.current.concurrency).toBe(5);
      expect(result.current.batchSize).toBe(100);
    });

    it('returns stored config when present', async () => {
      sql = makeSql({
        sync_optimization_configs: [
          {
            connectorId: 'conn1',
            workspaceId: 'ws1',
            entityType: '*',
            concurrency: 8,
            batchSize: 200,
            workerWeight: 1.5,
            autoTune: true,
            lastTunedAt: null,
          },
        ],
      });
      optimizer = new SyncParallelismOptimizer(sql as unknown as ReturnType<typeof import('postgres').default>);
      const result = await optimizer.getConfigWithRecommendation('conn1', 'ws1', []);
      expect(result.current.concurrency).toBe(8);
      expect(result.current.batchSize).toBe(200);
    });
  });
});
