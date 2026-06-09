import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorStoreTuner } from '../vector-store-tuner.js';
import type { IndexHealthReport } from '../vector-store-tuner.js';

function makeSql(overrides: Partial<Record<string, unknown>> = {}) {
  const defaultStat = [{ n_live_tup: '1000', n_dead_tup: '50', idx_scan: '200' }];
  const defaultIndex = [{ indexname: 'iris_entities_embedding_idx', indexdef: 'CREATE INDEX USING ivfflat (embedding vector_cosine_ops) WITH (lists = 40)' }];
  const defaultCount = [{ count: '1000' }];

  let call = 0;
  const responses = [
    overrides.stat ?? defaultStat,
    overrides.index ?? defaultIndex,
  ];

  const fn = vi.fn().mockImplementation(() => {
    const r = responses[call] ?? [];
    call++;
    return Promise.resolve(r);
  });
  (fn as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnThis();

  const countFn = vi.fn().mockResolvedValue(defaultCount);

  const proxy = new Proxy(fn, {
    get(target, prop) {
      if (prop === 'unsafe') return vi.fn().mockReturnThis();
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  });

  return { sql: proxy as unknown as ReturnType<typeof import('postgres').default>, countFn };
}

// ─── analyzeIndexHealth ───────────────────────────────────────────────────────

describe('VectorStoreTuner.analyzeIndexHealth', () => {
  it('returns correct rowCount from pg_stat', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '5000', n_dead_tup: '100', idx_scan: '50' }])
      .mockResolvedValueOnce([{ indexname: 'emb_idx', indexdef: 'CREATE INDEX USING ivfflat (embedding) WITH (lists = 70)' }]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.rowCount).toBe(5000);
  });

  it('calculates fragmentation percentage correctly', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '800', n_dead_tup: '200', idx_scan: '0' }])
      .mockResolvedValueOnce([]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.fragmentation).toBe(20);
  });

  it('reports indexExists=false when no vector index', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '100', n_dead_tup: '0', idx_scan: '0' }])
      .mockResolvedValueOnce([]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.indexExists).toBe(false);
    expect(report.indexType).toBeNull();
  });

  it('detects ivfflat index type and lists parameter', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '1000', n_dead_tup: '0', idx_scan: '500' }])
      .mockResolvedValueOnce([{ indexname: 'emb_idx', indexdef: 'CREATE INDEX USING ivfflat (embedding) WITH (lists = 32)' }]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.indexType).toBe('ivfflat');
    expect(report.lists).toBe(32);
  });

  it('detects hnsw index type', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '2000', n_dead_tup: '0', idx_scan: '100' }])
      .mockResolvedValueOnce([{ indexname: 'emb_hnsw', indexdef: 'CREATE INDEX USING hnsw (embedding vector_cosine_ops)' }]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.indexType).toBe('hnsw');
  });

  it('recommends creating index when none exists', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '500', n_dead_tup: '0', idx_scan: '0' }])
      .mockResolvedValueOnce([]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.recommendations.some((r) => r.includes('No vector index'))).toBe(true);
  });

  it('recommends VACUUM when fragmentation exceeds 20%', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '700', n_dead_tup: '300', idx_scan: '0' }])
      .mockResolvedValueOnce([{ indexname: 'e', indexdef: 'CREATE INDEX USING ivfflat (e) WITH (lists = 26)' }]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.recommendations.some((r) => r.includes('fragmentation'))).toBe(true);
  });

  it('recommends HNSW when rowCount > 100K with ivfflat', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '150000', n_dead_tup: '0', idx_scan: '1000' }])
      .mockResolvedValueOnce([{ indexname: 'e', indexdef: 'CREATE INDEX USING ivfflat (e) WITH (lists = 387)' }]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.recommendations.some((r) => r.includes('HNSW'))).toBe(true);
  });

  it('returns tableName in report', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '100', n_dead_tup: '0', idx_scan: '0' }])
      .mockResolvedValueOnce([]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth('my_table');
    expect(report.tableName).toBe('my_table');
  });

  it('returns healthy recommendation when no issues found', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ n_live_tup: '1000', n_dead_tup: '0', idx_scan: '500' }])
      .mockResolvedValueOnce([{ indexname: 'e', indexdef: 'CREATE INDEX USING ivfflat (e) WITH (lists = 32)' }]);
    const tuner = new VectorStoreTuner(sql as unknown as ReturnType<typeof import('postgres').default>);
    const report = await tuner.analyzeIndexHealth();
    expect(report.recommendations.some((r) => r.includes('healthy'))).toBe(true);
  });
});

// ─── recommendIndexStrategy ───────────────────────────────────────────────────

describe('VectorStoreTuner.recommendIndexStrategy', () => {
  let tuner: VectorStoreTuner;

  beforeEach(() => {
    const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
    tuner = new VectorStoreTuner(sql);
  });

  it('recommends ivfflat for small datasets (<10K rows)', () => {
    const strategy = tuner.recommendIndexStrategy(5000, 50);
    expect(strategy.indexType).toBe('ivfflat');
  });

  it('sets lists=sqrt(rowCount) for small datasets', () => {
    const strategy = tuner.recommendIndexStrategy(2500, 50);
    expect(strategy.lists).toBe(50); // sqrt(2500) = 50
  });

  it('recommends hnsw for large datasets (>=100K rows)', () => {
    const strategy = tuner.recommendIndexStrategy(200_000, 50);
    expect(strategy.indexType).toBe('hnsw');
  });

  it('recommends hnsw when latency SLA is tight (<20ms)', () => {
    const strategy = tuner.recommendIndexStrategy(50_000, 10);
    expect(strategy.indexType).toBe('hnsw');
  });

  it('hnsw recommendation includes efConstruction and m params', () => {
    const strategy = tuner.recommendIndexStrategy(200_000, 50);
    expect(strategy.efConstruction).toBeDefined();
    expect(strategy.m).toBeDefined();
  });

  it('recommends ivfflat with reasonable lists for mid-range (10K-100K)', () => {
    const strategy = tuner.recommendIndexStrategy(40_000, 50);
    expect(strategy.indexType).toBe('ivfflat');
    expect(strategy.lists).toBeGreaterThan(100);
  });

  it('returns a rationale string', () => {
    const strategy = tuner.recommendIndexStrategy(1000, 50);
    expect(typeof strategy.rationale).toBe('string');
    expect(strategy.rationale.length).toBeGreaterThan(0);
  });

  it('lists=1 minimum for tiny datasets (1 row)', () => {
    const strategy = tuner.recommendIndexStrategy(1, 50);
    expect(strategy.indexType).toBe('ivfflat');
    expect(strategy.lists).toBeGreaterThanOrEqual(1);
  });
});

// ─── executeReindexing ────────────────────────────────────────────────────────

describe('VectorStoreTuner.executeReindexing', () => {
  it('calls VACUUM, DROP INDEX, and CREATE INDEX in sequence', async () => {
    const calls: string[] = [];
    const sql = vi.fn().mockImplementation((...args: unknown[]) => {
      const query = String(args[0]);
      calls.push(query);
      if (query.includes('COUNT')) return Promise.resolve([{ count: '1000' }]);
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const tuner = new VectorStoreTuner(sql);
    await tuner.executeReindexing('iris_entities');
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('uses provided newLists when specified', async () => {
    const calls: string[] = [];
    const sql = vi.fn().mockImplementation((...args: unknown[]) => {
      const q = String(args[0]);
      calls.push(q);
      if (q.includes('COUNT')) return Promise.resolve([{ count: '500' }]);
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const tuner = new VectorStoreTuner(sql);
    await tuner.executeReindexing('iris_entities', 99);
    const createCall = calls.find((c) => c.includes('CREATE INDEX'));
    expect(createCall).toBeTruthy();
  });

  it('falls back to sqrt(rowCount) lists when newLists not provided', async () => {
    const sql = vi.fn().mockImplementation((...args: unknown[]) => {
      const q = String(args[0]);
      if (q.includes('COUNT')) return Promise.resolve([{ count: '900' }]);
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const tuner = new VectorStoreTuner(sql);
    await expect(tuner.executeReindexing()).resolves.toBeUndefined();
  });
});
