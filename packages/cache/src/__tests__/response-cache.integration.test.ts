/**
 * Integration tests for ResponseCache using a real Redis instance.
 * Requires: docker-compose up -d
 * Run with: pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { ResponseCache, withResponseCache } from '../response-cache.js';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

let redis: Redis;
let cache: ResponseCache;

const WORKSPACE = 'ws-integration';
const RESPONSE = { content: [{ type: 'text' as const, text: 'Integration test response' }] };

beforeAll(async () => {
  redis = new Redis(REDIS_URL);
  cache = new ResponseCache(redis);
  await cache.resetStats();
  // Cleanup any residual test keys
  await cache.invalidate(`iris:resp:*:${WORKSPACE}:*`);
});

afterAll(async () => {
  await cache.invalidate(`iris:resp:*:${WORKSPACE}:*`);
  await cache.resetStats();
  redis.disconnect();
});

describe('ResponseCache (integration)', () => {
  it('round-trips a cache entry', async () => {
    const key = cache.cacheKey('query-context', WORKSPACE, { query: 'test integration' });
    await cache.set(key, RESPONSE, 60);
    const result = await cache.get(key);
    expect(result).toEqual(RESPONSE);
  });

  it('returns null after TTL expiry (short sleep)', async () => {
    const key = cache.cacheKey('query-context', WORKSPACE, { query: 'ttl-test', unique: Date.now() });
    await cache.set(key, RESPONSE, 1);
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    const result = await cache.get(key);
    expect(result).toBeNull();
  });

  it('invalidates by pattern and deletes matching keys', async () => {
    const key1 = cache.cacheKey('list-entities', WORKSPACE, { workspaceId: WORKSPACE });
    const key2 = cache.cacheKey('get-metric', WORKSPACE, { name: 'revenue', workspaceId: WORKSPACE });
    await Promise.all([cache.set(key1, RESPONSE, 120), cache.set(key2, RESPONSE, 120)]);

    const deleted = await cache.invalidateWorkspace(WORKSPACE);
    expect(deleted).toBeGreaterThanOrEqual(2);

    const [r1, r2] = await Promise.all([cache.get(key1), cache.get(key2)]);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  it('tracks hit/miss stats correctly', async () => {
    await cache.resetStats();
    const key = cache.cacheKey('get-metric', WORKSPACE, { name: 'test-stat-metric', workspaceId: WORKSPACE });
    await cache.set(key, RESPONSE, 120);

    // hit
    await cache.get(key);
    await cache.recordHit('get-metric');

    // miss
    await cache.get('non-existent-key');
    await cache.recordMiss('get-metric');

    const stats = await cache.getStats();
    expect(stats.totalHits).toBe(1);
    expect(stats.totalMisses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it('withResponseCache helper — hit path skips handler', async () => {
    const input = { workspaceId: WORKSPACE, query: 'cache-helper-test', unique: Date.now() };
    const key = cache.cacheKey('query-context', WORKSPACE, input);
    await cache.set(key, RESPONSE, 120);

    let handlerCalled = false;
    const result = await withResponseCache('query-context', WORKSPACE, input, cache, async () => {
      handlerCalled = true;
      return { content: [{ type: 'text' as const, text: 'fresh response' }] };
    });

    expect(result).toEqual(RESPONSE);
    expect(handlerCalled).toBe(false);
  });

  it('withResponseCache helper — miss path executes handler and caches', async () => {
    const input = { workspaceId: WORKSPACE, query: 'cache-miss-integration-test', unique: Date.now() };
    const freshResponse = { content: [{ type: 'text' as const, text: 'fresh result' }] };

    const result = await withResponseCache('list-entities', WORKSPACE, input, cache, async () => freshResponse);
    expect(result).toEqual(freshResponse);

    // Second call should hit cache
    let handlerCalled = false;
    const result2 = await withResponseCache('list-entities', WORKSPACE, input, cache, async () => {
      handlerCalled = true;
      return { content: [{ type: 'text' as const, text: 'should not be called' }] };
    });
    expect(result2).toEqual(freshResponse);
    expect(handlerCalled).toBe(false);
  });
});
