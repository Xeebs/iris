import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import {
  ResponseCache,
  withResponseCache,
  TOOL_TTL_SECONDS,
  DEFAULT_TTL_SECONDS,
} from '../response-cache.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

const WORKSPACE = 'ws-test';
const RESPONSE = { content: [{ type: 'text' as const, text: 'hello world' }] };
const RESPONSE_2 = { content: [{ type: 'text' as const, text: 'different response' }] };

function makeMockRedis(overrides: Partial<Redis> = {}): Redis {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(['0', []]),
    incr: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    dbsize: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as Redis;
}

describe('ResponseCache', () => {
  let redis: Redis;
  let cache: ResponseCache;

  beforeEach(() => {
    redis = makeMockRedis();
    cache = new ResponseCache(redis);
  });

  // ── cacheKey ────────────────────────────────────────────────────────────────

  describe('cacheKey', () => {
    it('returns a deterministic key for the same inputs', () => {
      const k1 = cache.cacheKey('query-context', WORKSPACE, { query: 'foo', workspaceId: WORKSPACE });
      const k2 = cache.cacheKey('query-context', WORKSPACE, { query: 'foo', workspaceId: WORKSPACE });
      expect(k1).toBe(k2);
    });

    it('returns different keys for different queries', () => {
      const k1 = cache.cacheKey('query-context', WORKSPACE, { query: 'foo' });
      const k2 = cache.cacheKey('query-context', WORKSPACE, { query: 'bar' });
      expect(k1).not.toBe(k2);
    });

    it('returns different keys for different tools', () => {
      const k1 = cache.cacheKey('query-context', WORKSPACE, { query: 'foo' });
      const k2 = cache.cacheKey('list-entities', WORKSPACE, { query: 'foo' });
      expect(k1).not.toBe(k2);
    });

    it('returns different keys for different workspaces', () => {
      const k1 = cache.cacheKey('query-context', 'ws-a', { query: 'foo' });
      const k2 = cache.cacheKey('query-context', 'ws-b', { query: 'foo' });
      expect(k1).not.toBe(k2);
    });

    it('produces key ordering-independent hash (canonical JSON)', () => {
      const k1 = cache.cacheKey('query-context', WORKSPACE, { a: 1, b: 2 });
      const k2 = cache.cacheKey('query-context', WORKSPACE, { b: 2, a: 1 });
      expect(k1).toBe(k2);
    });

    it('prefixes key with iris:resp', () => {
      const k = cache.cacheKey('query-context', WORKSPACE, {});
      expect(k).toMatch(/^iris:resp:/);
    });
  });

  // ── get ─────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns null on cache miss', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const result = await cache.get('some-key');
      expect(result).toBeNull();
    });

    it('returns parsed response on cache hit', async () => {
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(RESPONSE));
      const result = await cache.get('some-key');
      expect(result).toEqual(RESPONSE);
    });

    it('returns null when Redis throws', async () => {
      vi.mocked(redis.get).mockRejectedValue(new Error('Redis down'));
      const result = await cache.get('some-key');
      expect(result).toBeNull();
    });

    it('returns null for corrupted JSON', async () => {
      vi.mocked(redis.get).mockResolvedValue('not-json{{{');
      const result = await cache.get('some-key');
      expect(result).toBeNull();
    });
  });

  // ── set ─────────────────────────────────────────────────────────────────────

  describe('set', () => {
    it('stores response with EX TTL', async () => {
      await cache.set('some-key', RESPONSE, 120);
      expect(redis.set).toHaveBeenCalledWith('some-key', JSON.stringify(RESPONSE), 'EX', 120);
    });

    it('does not throw when Redis set fails', async () => {
      vi.mocked(redis.set).mockRejectedValue(new Error('Redis down'));
      await expect(cache.set('some-key', RESPONSE, 60)).resolves.not.toThrow();
    });
  });

  // ── invalidate ──────────────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('deletes matching keys and returns count', async () => {
      vi.mocked(redis.scan)
        .mockResolvedValueOnce(['42', ['key1', 'key2']])
        .mockResolvedValueOnce(['0', ['key3']]);
      vi.mocked(redis.del).mockResolvedValue(2);

      const deleted = await cache.invalidate('iris:resp:*');
      expect(deleted).toBe(3);
      expect(redis.del).toHaveBeenCalledTimes(2);
    });

    it('returns 0 when no keys match', async () => {
      vi.mocked(redis.scan).mockResolvedValue(['0', []]);
      const deleted = await cache.invalidate('iris:resp:nonexistent:*');
      expect(deleted).toBe(0);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('handles scan cursor pagination correctly', async () => {
      vi.mocked(redis.scan)
        .mockResolvedValueOnce(['10', ['k1']])
        .mockResolvedValueOnce(['20', ['k2']])
        .mockResolvedValueOnce(['0', ['k3']]);

      const deleted = await cache.invalidate('iris:resp:*');
      expect(deleted).toBe(3);
    });

    it('does not throw when Redis scan fails', async () => {
      vi.mocked(redis.scan).mockRejectedValue(new Error('Redis error'));
      const deleted = await cache.invalidate('iris:resp:*');
      expect(deleted).toBe(0);
    });
  });

  // ── invalidateWorkspace ─────────────────────────────────────────────────────

  describe('invalidateWorkspace', () => {
    it('uses workspace pattern', async () => {
      const spy = vi.spyOn(cache, 'invalidate').mockResolvedValue(5);
      await cache.invalidateWorkspace('ws-test');
      expect(spy).toHaveBeenCalledWith('iris:resp:*:ws-test:*');
    });
  });

  // ── stats ───────────────────────────────────────────────────────────────────

  describe('recordHit/recordMiss', () => {
    it('increments global and per-tool counters on hit', async () => {
      await cache.recordHit('query-context');
      expect(redis.incr).toHaveBeenCalledWith('iris:resp:stats:hits');
      expect(redis.incr).toHaveBeenCalledWith('iris:resp:stats:query-context:hits');
    });

    it('increments global and per-tool counters on miss', async () => {
      await cache.recordMiss('list-entities');
      expect(redis.incr).toHaveBeenCalledWith('iris:resp:stats:misses');
      expect(redis.incr).toHaveBeenCalledWith('iris:resp:stats:list-entities:misses');
    });

    it('does not throw when Redis incr fails', async () => {
      vi.mocked(redis.incr).mockRejectedValue(new Error('fail'));
      await expect(cache.recordHit('tool')).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    it('returns zero stats when no events recorded', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const stats = await cache.getStats();
      expect(stats.totalHits).toBe(0);
      expect(stats.totalMisses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('calculates hit rate correctly', async () => {
      vi.mocked(redis.get).mockImplementation(async (key) => {
        if (String(key).includes(':hits') && !String(key).includes(':misses')) return '8';
        if (String(key).includes(':misses')) return '2';
        return null;
      });
      const stats = await cache.getStats();
      expect(stats.hitRate).toBeCloseTo(0.8);
    });

    it('returns zero stats when Redis throws', async () => {
      vi.mocked(redis.get).mockRejectedValue(new Error('fail'));
      const stats = await cache.getStats();
      expect(stats.totalHits).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('resetStats', () => {
    it('deletes all stats keys', async () => {
      vi.mocked(redis.keys).mockResolvedValue(['iris:resp:stats:hits', 'iris:resp:stats:misses']);
      await cache.resetStats();
      expect(redis.del).toHaveBeenCalledWith('iris:resp:stats:hits', 'iris:resp:stats:misses');
    });

    it('does nothing when no stats keys exist', async () => {
      vi.mocked(redis.keys).mockResolvedValue([]);
      await cache.resetStats();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });
});

// ── TOOL_TTL_SECONDS ──────────────────────────────────────────────────────────

describe('TOOL_TTL_SECONDS', () => {
  it('sets 2-minute TTL for query-context', () => {
    expect(TOOL_TTL_SECONDS['query-context']).toBe(120);
  });

  it('sets 5-minute TTL for list-entities', () => {
    expect(TOOL_TTL_SECONDS['list-entities']).toBe(300);
  });

  it('sets 1-hour TTL for get-metric', () => {
    expect(TOOL_TTL_SECONDS['get-metric']).toBe(3600);
  });

  it('sets 1-hour TTL for list-glossary', () => {
    expect(TOOL_TTL_SECONDS['list-glossary']).toBe(3600);
  });

  it('default TTL is 5 minutes', () => {
    expect(DEFAULT_TTL_SECONDS).toBe(300);
  });
});

// ── withResponseCache ─────────────────────────────────────────────────────────

describe('withResponseCache', () => {
  let redis: Redis;
  let cache: ResponseCache;

  beforeEach(() => {
    redis = makeMockRedis();
    cache = new ResponseCache(redis);
  });

  it('returns cached response on hit and does not call handler', async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(RESPONSE));
    const handler = vi.fn().mockResolvedValue(RESPONSE_2);

    const result = await withResponseCache('query-context', WORKSPACE, { query: 'foo' }, cache, handler);
    expect(result).toEqual(RESPONSE);
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls handler on miss and caches result', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    const handler = vi.fn().mockResolvedValue(RESPONSE);

    const result = await withResponseCache('query-context', WORKSPACE, { query: 'foo' }, cache, handler);
    expect(result).toEqual(RESPONSE);
    expect(handler).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalled();
  });

  it('uses correct TTL from TOOL_TTL_SECONDS', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    const handler = vi.fn().mockResolvedValue(RESPONSE);

    await withResponseCache('get-metric', WORKSPACE, { name: 'revenue' }, cache, handler);
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 3600);
  });

  it('uses default TTL for unknown tool names', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    const handler = vi.fn().mockResolvedValue(RESPONSE);

    await withResponseCache('unknown-tool', WORKSPACE, {}, cache, handler);
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', DEFAULT_TTL_SECONDS);
  });
});
