import { describe, it, expect, vi } from 'vitest';
import {
  computeAggregateStats,
  detectTrend,
  findSharedContextIds,
  computeAttributeCoverage,
  BatchContextRecommender,
} from '../batch-recommender.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── computeAggregateStats ────────────────────────────────────────────────────

describe('computeAggregateStats', () => {
  it('returns zeros for empty array', () => {
    const r = computeAggregateStats([]);
    expect(r).toEqual({ mean: 0, variance: 0, min: 0, max: 0 });
  });

  it('returns correct stats for single value', () => {
    const r = computeAggregateStats([5]);
    expect(r.mean).toBe(5);
    expect(r.variance).toBe(0);
    expect(r.min).toBe(5);
    expect(r.max).toBe(5);
  });

  it('computes mean correctly', () => {
    expect(computeAggregateStats([2, 4, 6]).mean).toBeCloseTo(4);
  });

  it('computes variance correctly', () => {
    const { variance } = computeAggregateStats([2, 4, 6]);
    expect(variance).toBeCloseTo(2.667, 2);
  });

  it('returns correct min and max', () => {
    const r = computeAggregateStats([1, 7, 3, 9, 2]);
    expect(r.min).toBe(1);
    expect(r.max).toBe(9);
  });
});

// ─── detectTrend ──────────────────────────────────────────────────────────────

describe('detectTrend', () => {
  it('returns stable for single score', () => {
    expect(detectTrend([0.5])).toBe('stable');
  });

  it('returns stable for flat series', () => {
    expect(detectTrend([0.5, 0.5, 0.5, 0.5])).toBe('stable');
  });

  it('returns up for rising series', () => {
    expect(detectTrend([0.1, 0.3, 0.5, 0.7, 0.9])).toBe('up');
  });

  it('returns down for declining series', () => {
    expect(detectTrend([0.9, 0.7, 0.5, 0.3, 0.1])).toBe('down');
  });

  it('returns stable for near-zero slope', () => {
    expect(detectTrend([0.5, 0.501, 0.499, 0.5])).toBe('stable');
  });
});

// ─── findSharedContextIds ─────────────────────────────────────────────────────

describe('findSharedContextIds', () => {
  it('returns empty for no overlapping contexts', () => {
    const map = new Map([
      ['e1', ['c1', 'c2']],
      ['e2', ['c3', 'c4']],
    ]);
    expect(findSharedContextIds(map)).toHaveLength(0);
  });

  it('finds context shared by 2 entities', () => {
    const map = new Map([
      ['e1', ['c1', 'c2']],
      ['e2', ['c1', 'c3']],
    ]);
    const shared = findSharedContextIds(map);
    expect(shared).toHaveLength(1);
    expect(shared[0]!.contextId).toBe('c1');
    expect(shared[0]!.entityIds).toHaveLength(2);
  });

  it('respects minShared threshold', () => {
    const map = new Map([
      ['e1', ['c1']],
      ['e2', ['c1']],
      ['e3', ['c1']],
    ]);
    expect(findSharedContextIds(map, 3)).toHaveLength(1);
    expect(findSharedContextIds(map, 4)).toHaveLength(0);
  });

  it('sorts by number of sharing entities (descending)', () => {
    const map = new Map([
      ['e1', ['c1', 'c2']],
      ['e2', ['c1', 'c2']],
      ['e3', ['c1']],
    ]);
    const shared = findSharedContextIds(map);
    expect(shared[0]!.entityIds.length).toBeGreaterThanOrEqual(shared[1]!.entityIds.length);
  });
});

// ─── computeAttributeCoverage ─────────────────────────────────────────────────

describe('computeAttributeCoverage', () => {
  it('returns zero coverage for empty entities', () => {
    const r = computeAttributeCoverage([], 'name');
    expect(r.coverage).toBe(0);
  });

  it('returns full coverage when all have the attribute', () => {
    const r = computeAttributeCoverage([{ name: 'Alice' }, { name: 'Bob' }], 'name');
    expect(r.coverage).toBe(1);
  });

  it('returns correct coverage for partial presence', () => {
    const r = computeAttributeCoverage([{ name: 'Alice' }, { age: 30 }], 'name');
    expect(r.coverage).toBe(0.5);
  });

  it('detects common value when all agree', () => {
    const r = computeAttributeCoverage([{ status: 'active' }, { status: 'active' }], 'status');
    expect(r.commonValue).toBe('active');
    expect(r.divergent).toBe(false);
  });

  it('marks divergent when values differ', () => {
    const r = computeAttributeCoverage([{ status: 'active' }, { status: 'inactive' }], 'status');
    expect(r.commonValue).toBeNull();
    expect(r.divergent).toBe(true);
  });
});

// ─── BatchContextRecommender ──────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('BatchContextRecommender.recommendContextForEntities', () => {
  it('returns err for empty entityIds', async () => {
    const svc = new BatchContextRecommender(makeSql());
    const r = await svc.recommendContextForEntities([]);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain('empty');
  });

  it('returns result with sessionId', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ id: 'e1', type: 'contact', label: 'Alice' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new BatchContextRecommender(sql);
    const r = await svc.recommendContextForEntities(['e1']);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().sessionId).toBeDefined();
  });

  it('returns shared contexts when multiple entities share context', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([
        { id: 'e1', type: 'contact', label: 'Alice' },
        { id: 'e2', type: 'contact', label: 'Bob' },
      ])
      .mockResolvedValueOnce([
        { entity_id: 'e1', entity_type: 'contact', context_entity_id: 'c1', score: 0.9 },
        { entity_id: 'e2', entity_type: 'contact', context_entity_id: 'c1', score: 0.8 },
      ])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new BatchContextRecommender(sql);
    const r = await svc.recommendContextForEntities(['e1', 'e2']);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().sharedContexts.length).toBeGreaterThan(0);
  });
});

describe('BatchContextRecommender.analyzeEntityGroup', () => {
  it('returns err for empty entityIds', async () => {
    const svc = new BatchContextRecommender(makeSql());
    const r = await svc.analyzeEntityGroup([]);
    expect(r.isErr()).toBe(true);
  });

  it('returns err when no entities found', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new BatchContextRecommender(sql);
    const r = await svc.analyzeEntityGroup(['unknown']);
    expect(r.isErr()).toBe(true);
  });

  it('identifies common types', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([
        { id: 'e1', type: 'contact', attributes: { name: 'Alice', status: 'active' } },
        { id: 'e2', type: 'contact', attributes: { name: 'Bob', status: 'active' } },
      ])
      .mockResolvedValueOnce([{ count: 1 }]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new BatchContextRecommender(sql);
    const r = await svc.analyzeEntityGroup(['e1', 'e2']);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().commonTypes).toContain('contact');
  });
});

describe('BatchContextRecommender.suggestGroupActions', () => {
  it('returns err for empty entityIds', async () => {
    const svc = new BatchContextRecommender(makeSql());
    const r = await svc.suggestGroupActions([]);
    expect(r.isErr()).toBe(true);
  });

  it('suggests bulk_link when relationship density is low', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([
        { id: 'e1', type: 'contact', attributes: {} },
        { id: 'e2', type: 'contact', attributes: {} },
      ])
      .mockResolvedValueOnce([{ count: 0 }]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new BatchContextRecommender(sql);
    const r = await svc.suggestGroupActions(['e1', 'e2']);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().some((a) => a.action === 'bulk_link')).toBe(true);
  });
});

describe('BatchContextRecommender.computeGroupScore', () => {
  it('returns err for empty entityIds', async () => {
    const svc = new BatchContextRecommender(makeSql());
    const r = await svc.computeGroupScore([], 'completeness');
    expect(r.isErr()).toBe(true);
  });

  it('returns score stats for known metric', async () => {
    const sql = makeSql([
      { entity_id: 'e1', score: 0.8, recorded_at: new Date() },
      { entity_id: 'e2', score: 0.6, recorded_at: new Date() },
    ]);
    const svc = new BatchContextRecommender(sql);
    const r = await svc.computeGroupScore(['e1', 'e2'], 'completeness');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().metric).toBe('completeness');
    expect(r._unsafeUnwrap().mean).toBeCloseTo(0.7);
  });

  it('returns stable trend for empty score history', async () => {
    const svc = new BatchContextRecommender(makeSql([]));
    const r = await svc.computeGroupScore(['e1'], 'recency');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().trend).toBe('stable');
  });
});

describe('BatchContextRecommender.getSessionResult', () => {
  it('returns err when session not found', async () => {
    const svc = new BatchContextRecommender(makeSql([]));
    const r = await svc.getSessionResult('missing');
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns parsed result when session found', async () => {
    const payload = { perEntity: [], sharedContexts: [] };
    const sql = makeSql([{ id: 'sess1', entity_ids: '["e1"]', result_json: JSON.stringify(payload), created_at: new Date() }]);
    const svc = new BatchContextRecommender(sql);
    const r = await svc.getSessionResult('sess1');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().sessionId).toBe('sess1');
  });
});
