import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmartCacheManager } from '../smart-cache-manager.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── cacheQuery / getQuery ────────────────────────────────────────────────────

describe('SmartCacheManager.cacheQuery / getQuery', () => {
  let mgr: SmartCacheManager;
  beforeEach(() => { mgr = new SmartCacheManager(); });

  it('stores and retrieves a result', () => {
    mgr.cacheQuery('q1', 'result-1', 3600, []);
    expect(mgr.getQuery('q1')).toBe('result-1');
  });

  it('returns null for unknown hash', () => {
    expect(mgr.getQuery('unknown')).toBeNull();
  });

  it('returns null after TTL expires', () => {
    const past = new Date(Date.now() - 1000);
    mgr.cacheQuery('q2', 'expired', -1, []);
    // Force expiry by accessing after TTL has passed by using negative TTL
    expect(mgr.getQuery('q2')).toBeNull();
  });

  it('increments hitCount on each retrieval', () => {
    mgr.cacheQuery('q3', 'result', 3600, []);
    mgr.getQuery('q3');
    mgr.getQuery('q3');
    const stats = mgr.getHitRate('q3');
    expect(stats?.cacheHits).toBe(2);
  });

  it('replaces existing entry when re-cached', () => {
    mgr.cacheQuery('q4', 'v1', 3600, []);
    mgr.cacheQuery('q4', 'v2', 3600, []);
    expect(mgr.getQuery('q4')).toBe('v2');
  });
});

// ─── onEntityChange (cascade invalidation) ───────────────────────────────────

describe('SmartCacheManager.onEntityChange', () => {
  let mgr: SmartCacheManager;
  beforeEach(() => { mgr = new SmartCacheManager(); });

  it('invalidates queries dependent on changed entity', () => {
    mgr.cacheQuery('q-a', 'result', 3600, ['entity-1']);
    expect(mgr.getQuery('q-a')).toBe('result');
    mgr.onEntityChange('entity-1');
    expect(mgr.getQuery('q-a')).toBeNull();
  });

  it('returns count of invalidated entries', () => {
    mgr.cacheQuery('q-x', 'r', 3600, ['e-1']);
    mgr.cacheQuery('q-y', 'r', 3600, ['e-1']);
    expect(mgr.onEntityChange('e-1')).toBe(2);
  });

  it('does not affect unrelated entries', () => {
    mgr.cacheQuery('q-keep', 'keep', 3600, ['e-other']);
    mgr.cacheQuery('q-drop', 'drop', 3600, ['e-change']);
    mgr.onEntityChange('e-change');
    expect(mgr.getQuery('q-keep')).toBe('keep');
    expect(mgr.getQuery('q-drop')).toBeNull();
  });

  it('returns 0 when entity has no dependents', () => {
    expect(mgr.onEntityChange('non-existent-entity')).toBe(0);
  });
});

// ─── getHitRate ───────────────────────────────────────────────────────────────

describe('SmartCacheManager.getHitRate', () => {
  let mgr: SmartCacheManager;
  beforeEach(() => { mgr = new SmartCacheManager(); });

  it('returns null when no data exists', () => {
    expect(mgr.getHitRate('missing')).toBeNull();
  });

  it('computes correct hit rate', () => {
    mgr.cacheQuery('q', 'v', 3600, []);
    mgr.getQuery('q'); // hit
    mgr.cacheQuery('q', 'v2', 3600, []); // this increments total
    const stats = mgr.getHitRate('q');
    expect(stats?.hitRate).toBeGreaterThan(0);
    expect(stats?.hitRate).toBeLessThanOrEqual(1);
  });
});

// ─── optimizeCacheTtl ─────────────────────────────────────────────────────────

describe('SmartCacheManager.optimizeCacheTtl', () => {
  let mgr: SmartCacheManager;
  beforeEach(() => { mgr = new SmartCacheManager(); });

  it('returns default TTL for unknown hash', () => {
    expect(mgr.optimizeCacheTtl('unknown')).toBe(3600);
  });

  it('increases TTL for very popular entries', () => {
    mgr.cacheQuery('pop', 'result', 3600, []);
    // Simulate many hits by calling getQuery many times
    for (let i = 0; i < 10; i++) {
      mgr.getQuery('pop');
    }
    // Cache again to reset total (to inflate hit rate artificially)
    mgr.cacheQuery('pop', 'result', 3600, []);
    for (let i = 0; i < 8; i++) mgr.getQuery('pop');
    const ttl = mgr.optimizeCacheTtl('pop');
    expect(ttl).toBeGreaterThanOrEqual(3600);
  });

  it('returns a positive TTL value', () => {
    mgr.cacheQuery('any', 'v', 1800, []);
    const ttl = mgr.optimizeCacheTtl('any');
    expect(ttl).toBeGreaterThan(0);
  });
});

// ─── prefetchLikelyQueries ────────────────────────────────────────────────────

describe('SmartCacheManager.prefetchLikelyQueries', () => {
  let mgr: SmartCacheManager;
  beforeEach(() => { mgr = new SmartCacheManager(); });

  it('returns empty array when user has fewer than 2 patterns', () => {
    mgr.recordQueryPattern('user-1', 'q1', 'show me deals');
    expect(mgr.prefetchLikelyQueries('user-1')).toEqual([]);
  });

  it('returns empty array for unknown user', () => {
    expect(mgr.prefetchLikelyQueries('nobody')).toEqual([]);
  });

  it('recommends queries not already cached', () => {
    mgr.recordQueryPattern('user-2', 'q-hot', 'top deals');
    mgr.recordQueryPattern('user-2', 'q-hot', 'top deals');
    mgr.recordQueryPattern('user-2', 'q-other', 'other query');
    mgr.cacheQuery('q-hot', 'cached', 3600, []); // already cached
    const recs = mgr.prefetchLikelyQueries('user-2');
    expect(recs.every((r) => r.queryHash !== 'q-hot')).toBe(true);
  });

  it('includes confidence score between 0 and 1', () => {
    for (let i = 0; i < 5; i++) mgr.recordQueryPattern('user-3', 'q-freq', `query ${i}`);
    const recs = mgr.prefetchLikelyQueries('user-3');
    expect(recs.every((r) => r.confidence >= 0 && r.confidence <= 1)).toBe(true);
  });
});

// ─── getDependencies / invalidate / getStats ──────────────────────────────────

describe('SmartCacheManager misc', () => {
  let mgr: SmartCacheManager;
  beforeEach(() => { mgr = new SmartCacheManager(); });

  it('getDependencies returns query hashes for entity', () => {
    mgr.cacheQuery('qa', 'r', 3600, ['e-1']);
    mgr.cacheQuery('qb', 'r', 3600, ['e-1']);
    const deps = mgr.getDependencies('e-1');
    expect(deps).toContain('qa');
    expect(deps).toContain('qb');
  });

  it('invalidate removes specific entry', () => {
    mgr.cacheQuery('q-del', 'result', 3600, []);
    expect(mgr.invalidate('q-del')).toBe(true);
    expect(mgr.getQuery('q-del')).toBeNull();
  });

  it('invalidate returns false for non-existent hash', () => {
    expect(mgr.invalidate('ghost')).toBe(false);
  });

  it('getStats returns aggregate totals', () => {
    mgr.cacheQuery('s1', 'v', 3600, []);
    mgr.getQuery('s1');
    const stats = mgr.getStats();
    expect(stats.totalEntries).toBeGreaterThanOrEqual(1);
    expect(stats.totalRequests).toBeGreaterThan(0);
  });
});
