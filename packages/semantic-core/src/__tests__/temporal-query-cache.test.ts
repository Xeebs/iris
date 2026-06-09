import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hashQuery,
  normalizeQuery,
  isDateCompatible,
  computeDefaultExpiry,
  TemporalQueryCache,
} from '../temporal-query-cache.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── Pure function tests ─────────────────────────────────────────────────────

describe('hashQuery', () => {
  it('returns 8-char hex string', () => {
    const h = hashQuery('find contacts');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(hashQuery('find contacts')).toBe(hashQuery('find contacts'));
  });

  it('differs for different inputs', () => {
    expect(hashQuery('find contacts')).not.toBe(hashQuery('find deals'));
  });
});

describe('normalizeQuery', () => {
  it('trims whitespace', () => {
    expect(normalizeQuery('  hello  ')).toBe('hello');
  });

  it('lowercases', () => {
    expect(normalizeQuery('Find Contacts')).toBe('find contacts');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeQuery('find   contacts  now')).toBe('find contacts now');
  });

  it('same hash for normalized variants', () => {
    expect(hashQuery(normalizeQuery('  Find Contacts  '))).toBe(
      hashQuery(normalizeQuery('find contacts')),
    );
  });
});

describe('isDateCompatible', () => {
  it('returns true when cacheDate is before targetDate', () => {
    const cache = new Date('2026-06-01');
    const target = new Date('2026-06-08');
    expect(isDateCompatible(cache, target)).toBe(true);
  });

  it('returns true when cacheDate is same day as targetDate', () => {
    const cache = new Date('2026-06-08T10:00:00Z');
    const target = new Date('2026-06-08T23:00:00Z');
    expect(isDateCompatible(cache, target)).toBe(true);
  });

  it('returns false when cacheDate is after targetDate', () => {
    const cache = new Date('2026-06-09');
    const target = new Date('2026-06-08');
    expect(isDateCompatible(cache, target)).toBe(false);
  });
});

describe('computeDefaultExpiry', () => {
  it('returns date 24h after asOfDate', () => {
    const asOf = new Date('2026-06-08T12:00:00Z');
    const expiry = computeDefaultExpiry(asOf);
    expect(expiry.getTime()).toBe(asOf.getTime() + 24 * 60 * 60 * 1000);
  });

  it('does not mutate input date', () => {
    const asOf = new Date('2026-06-08T12:00:00Z');
    const original = asOf.getTime();
    computeDefaultExpiry(asOf);
    expect(asOf.getTime()).toBe(original);
  });
});

// ─── TemporalQueryCache service tests ────────────────────────────────────────

function makeSql(overrides: Partial<Record<string, unknown>> = {}) {
  const defaultRows = {
    cacheQueryResult: [{ id: 'cache-uuid-1' }],
    queryAsOfDate: [],
    analyzeCacheHits: [
      [{ total: 100, hits: 75, misses: 25 }],
      [{ query_hash: 'abc12345', miss_count: 10, last_missed_at: new Date() }],
      [{ miss_reason: 'no_entry', cnt: 25 }],
    ],
    warmCacheProactively: [],
    evictExpired: { count: 5 },
  };

  let callIndex = 0;
  const rows = overrides['rows'] as unknown[][] | undefined;

  const sqlFn = vi.fn().mockImplementation(() => {
    if (rows) {
      const result = rows[callIndex++] ?? [];
      return Promise.resolve(result);
    }
    return Promise.resolve(defaultRows.cacheQueryResult);
  });

  return sqlFn as unknown as ReturnType<typeof import('postgres').default>;
}

describe('TemporalQueryCache.cacheQueryResult', () => {
  it('returns ok with the new entry id', async () => {
    const sql = makeSql();
    const cache = new TemporalQueryCache(sql);
    const result = await cache.cacheQueryResult(
      'find contacts',
      { entities: [] },
      new Date('2026-06-08'),
    );
    expect(result.isOk()).toBe(true);
    expect(result.value).toBe('cache-uuid-1');
  });

  it('returns err on db failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as ReturnType<
      typeof import('postgres').default
    >;
    const cache = new TemporalQueryCache(sql);
    const result = await cache.cacheQueryResult('find contacts', {}, new Date());
    expect(result.isErr()).toBe(true);
    expect(result.error.message).toBe('db error');
  });

  it('uses normalized query for hash', async () => {
    const sql = makeSql();
    const cache = new TemporalQueryCache(sql);
    await cache.cacheQueryResult('  Find Contacts  ', {}, new Date());
    const call = vi.mocked(sql).mock.calls[0];
    // The normalized text should appear in the template call
    const callArgs = call?.flat().join(' ') ?? '';
    expect(callArgs).not.toContain('  Find Contacts  ');
  });
});

describe('TemporalQueryCache.queryAsOfDate', () => {
  it('returns null when no cache entry found', async () => {
    const calls: unknown[][] = [
      [],   // SELECT from temporal_query_cache → miss
      [],   // INSERT into cache_hit_analysis
    ];
    const sql = makeSql({ rows: calls });
    const cache = new TemporalQueryCache(sql);
    const result = await cache.queryAsOfDate('find contacts', new Date('2026-06-08'));
    expect(result.isOk()).toBe(true);
    expect(result.value).toBeNull();
  });

  it('returns cached entry when found', async () => {
    const now = new Date('2026-06-08T12:00:00Z');
    const entry = {
      queryId: 'cache-uuid-1',
      queryHash: 'abc12345',
      result: { entities: [{ id: 'e1' }] },
      asOfDate: now,
      expiresAt: new Date(now.getTime() + 86400000),
      hitCount: 3,
      createdAt: now,
    };
    const calls: unknown[][] = [
      [entry],   // SELECT hit
      [],        // INSERT hit record
      [],        // UPDATE hit count
    ];
    const sql = makeSql({ rows: calls });
    const cache = new TemporalQueryCache(sql);
    const result = await cache.queryAsOfDate('find contacts', now);
    expect(result.isOk()).toBe(true);
    expect(result.value).not.toBeNull();
    expect(result.value?.queryId).toBe('cache-uuid-1');
  });

  it('returns err on db failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as ReturnType<
      typeof import('postgres').default
    >;
    const cache = new TemporalQueryCache(sql);
    const result = await cache.queryAsOfDate('find contacts', new Date());
    expect(result.isErr()).toBe(true);
  });
});

describe('TemporalQueryCache.analyzeCacheHits', () => {
  it('returns analytics with hit rate', async () => {
    const calls: unknown[][] = [
      [{ total: '100', hits: '75', misses: '25' }],
      [{ query_hash: 'abc12345', miss_count: '10', last_missed_at: new Date() }],
      [{ miss_reason: 'no_entry', cnt: '25' }],
    ];
    const sql = makeSql({ rows: calls });
    const cache = new TemporalQueryCache(sql);
    const result = await cache.analyzeCacheHits(7);
    expect(result.isOk()).toBe(true);
    expect(result.value.hitRate).toBeCloseTo(0.75);
    expect(result.value.totalRequests).toBe(100);
    expect(result.value.topMissedQueries).toHaveLength(1);
    expect(result.value.missPatterns[0]?.reason).toBe('no_entry');
  });

  it('returns 0 hit rate when no requests', async () => {
    const calls: unknown[][] = [
      [{ total: '0', hits: '0', misses: '0' }],
      [],
      [],
    ];
    const sql = makeSql({ rows: calls });
    const cache = new TemporalQueryCache(sql);
    const result = await cache.analyzeCacheHits(1);
    expect(result.isOk()).toBe(true);
    expect(result.value.hitRate).toBe(0);
  });

  it('returns err on db failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db down')) as unknown as ReturnType<
      typeof import('postgres').default
    >;
    const cache = new TemporalQueryCache(sql);
    const result = await cache.analyzeCacheHits();
    expect(result.isErr()).toBe(true);
  });
});

describe('TemporalQueryCache.warmCacheProactively', () => {
  it('reports warmed and skipped counts', async () => {
    const candidates = [
      { query_hash: 'h1', access_count: '5', query_text: 'find deals' },
      { query_hash: 'h2', access_count: '3', query_text: 'find contacts' },
    ];
    const calls: unknown[][] = [
      candidates,        // SELECT candidates
      [{ id: 'e1' }],    // h1 — already cached → skip
      [],                // h2 — not cached
      [],                // INSERT warming log for h2
    ];
    const sql = makeSql({ rows: calls });
    const cache = new TemporalQueryCache(sql);
    const result = await cache.warmCacheProactively(3);
    expect(result.isOk()).toBe(true);
    expect(result.value.candidates).toHaveLength(2);
    expect(result.value.warmed + result.value.skipped).toBe(2);
  });

  it('returns empty result when no candidates', async () => {
    const calls: unknown[][] = [[/* no candidates */]];
    const sql = makeSql({ rows: calls });
    const cache = new TemporalQueryCache(sql);
    const result = await cache.warmCacheProactively();
    expect(result.isOk()).toBe(true);
    expect(result.value.warmed).toBe(0);
    expect(result.value.skipped).toBe(0);
    expect(result.value.candidates).toHaveLength(0);
  });
});

describe('TemporalQueryCache.evictExpired', () => {
  it('returns the count of evicted rows', async () => {
    const sql = vi.fn().mockResolvedValue({ count: 12 }) as unknown as ReturnType<
      typeof import('postgres').default
    >;
    const cache = new TemporalQueryCache(sql);
    const result = await cache.evictExpired(30);
    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(12);
  });

  it('returns err on db failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('table locked')) as unknown as ReturnType<
      typeof import('postgres').default
    >;
    const cache = new TemporalQueryCache(sql);
    const result = await cache.evictExpired();
    expect(result.isErr()).toBe(true);
  });
});
