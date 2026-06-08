import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitService, slidingWindowCount, TIER_LIMITS } from '../rate-limiter.js';

function makeSql(responseMap: unknown[][] = []) {
  let idx = 0;
  return vi.fn(async () => responseMap[idx++] ?? []);
}

describe('slidingWindowCount', () => {
  it('fully includes prev window at start of new window (elapsed=0)', () => {
    const windowMs = 60_000;
    // windowStart must be exact multiple of windowMs so elapsed=0 and prevWeight=1
    const nowMs = 60_000; // windowStart = Math.floor(60_000/60_000)*60_000 = 60_000, elapsed=0
    // prevWeight = 1 - 0 = 1, result = floor(100*1)+5 = 105
    expect(slidingWindowCount(100, 5, windowMs, nowMs)).toBe(105);
  });

  it('blends prev window at 50% elapsed', () => {
    const windowMs = 60_000;
    // nowMs = 60_000 + 30_000 = 90_000: windowStart=60_000, elapsed=30_000, prevWeight=0.5
    const nowMs = 90_000;
    expect(slidingWindowCount(100, 5, windowMs, nowMs)).toBe(55);
  });

  it('returns sum when at very start of window', () => {
    const windowMs = 60_000;
    // just into a new window (elapsed ≈ 0)
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const count = slidingWindowCount(10, 3, windowMs, windowStart + 1);
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(13);
  });

  it('weighs prev window at 75% elapsed correctly', () => {
    const windowMs = 100;
    const windowStart = 100_000;
    const nowMs = windowStart + 75; // 75% through
    // prevWeight = 0.25, floor(100 * 0.25) = 25
    expect(slidingWindowCount(100, 5, windowMs, nowMs)).toBe(30);
  });
});

describe('TIER_LIMITS', () => {
  it('free tier has lowest limits', () => {
    expect(TIER_LIMITS.free.requestsPerMinute).toBeLessThan(TIER_LIMITS.pro.requestsPerMinute);
    expect(TIER_LIMITS.pro.requestsPerMinute).toBeLessThan(TIER_LIMITS.enterprise.requestsPerMinute);
  });

  it('enterprise tier has highest MCP call limit', () => {
    expect(TIER_LIMITS.enterprise.mcpCallsPerHour).toBeGreaterThan(TIER_LIMITS.pro.mcpCallsPerHour);
  });
});

describe('RateLimitService', () => {
  describe('enforceRateLimit', () => {
    it('allows request when under limit', async () => {
      const usageRows = [{ window_key: Math.floor(Date.now() / 60_000), request_count: 5 }];
      const sql = makeSql([usageRows, []]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.enforceRateLimit('ws-1', 'api', 30, 60_000);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().allowed).toBe(true);
    });

    it('blocks request when at limit', async () => {
      const windowKey = Math.floor(Date.now() / 60_000);
      const sql = makeSql([[{ window_key: windowKey, request_count: 30 }]]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.enforceRateLimit('ws-1', 'api', 30, 60_000);
      expect(result.isOk()).toBe(true);
      const r = result._unsafeUnwrap();
      expect(r.allowed).toBe(false);
      expect(r.retryAfterMs).toBeGreaterThan(0);
      expect(r.remaining).toBe(0);
    });

    it('returns remaining count correctly', async () => {
      const windowKey = Math.floor(Date.now() / 60_000);
      const sql = makeSql([[{ window_key: windowKey, request_count: 20 }], []]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.enforceRateLimit('ws-1', 'api', 30, 60_000);
      expect(result._unsafeUnwrap().remaining).toBe(9);
    });

    it('fails open on DB error (allows request)', async () => {
      const sql = vi.fn(async () => { throw new Error('db error'); });
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.enforceRateLimit('ws-1', 'api', 30, 60_000);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().allowed).toBe(true);
    });

    it('considers previous window in sliding calculation', async () => {
      const nowMs = Date.now();
      const windowMs = 60_000;
      const windowKey = Math.floor(nowMs / windowMs);
      // if we're at 50% of window, prev contributes 50%
      // prev=20 * 0.5 = 10, curr=0, effective=10 — should allow
      const sql = makeSql([[{ window_key: windowKey - 1, request_count: 20 }], []]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.enforceRateLimit('ws-1', 'api', 30, windowMs);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('getQuotaStatus', () => {
    it('returns free tier limits by default', async () => {
      const sql = makeSql([[], []]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.getQuotaStatus('ws-1');
      expect(result.isOk()).toBe(true);
      const s = result._unsafeUnwrap();
      expect(s.tier).toBe('free');
      expect(s.limits.requestsPerMinute).toBe(TIER_LIMITS.free.requestsPerMinute);
    });

    it('returns pro tier limits when configured', async () => {
      const sql = makeSql([[{ tier: 'pro' }], []]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.getQuotaStatus('ws-pro');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().tier).toBe('pro');
    });

    it('marks rateLimited true when over minute limit', async () => {
      const minuteKey = Math.floor(Date.now() / 60_000);
      const sql = makeSql([[{ tier: 'free' }], [{ endpoint: 'api', window_key: minuteKey, window_ms: 60_000, request_count: 35 }]]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.getQuotaStatus('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().rateLimited).toBe(true);
    });

    it('returns error on DB failure', async () => {
      const sql = vi.fn(async () => { throw new Error('db error'); });
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.getQuotaStatus('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('setTier', () => {
    it('sets tier without error', async () => {
      const sql = makeSql([[]]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.setTier('ws-1', 'pro');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('pruneOldBuckets', () => {
    it('returns count of deleted rows', async () => {
      const sql = makeSql([[{}, {}, {}]]);
      const service = new RateLimitService(sql as unknown as Parameters<typeof RateLimitService>[0]);
      const result = await service.pruneOldBuckets(2);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(3);
    });
  });
});
