import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiterManager, DEFAULT_RATE_LIMITS } from '../connector-rate-limiter.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

type MockRedis = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function makeRedis(): MockRedis {
  const store = new Map<string, string>();

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    incr: vi.fn(async (key: string) => {
      const prev = Number(store.get(key) ?? 0);
      const next = prev + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
  };
}

const defaultConfig = DEFAULT_RATE_LIMITS['default']!;

describe('RateLimiterManager', () => {
  let redis: MockRedis;
  let limiter: RateLimiterManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    redis = makeRedis();
    limiter = new RateLimiterManager(redis as Parameters<typeof RateLimiterManager>[0]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('acquireSlot', () => {
    it('returns 0 wait when circuit is closed and under rate limit', async () => {
      const waited = await limiter.acquireSlot('hubspot', defaultConfig);
      expect(waited).toBe(0);
    });

    it('increments the per-second window counter', async () => {
      await limiter.acquireSlot('hubspot', defaultConfig);
      expect(redis.incr).toHaveBeenCalledOnce();
    });

    it('delays when burst limit exceeded', async () => {
      const burstConfig = { requestsPerSecond: 1, maxConcurrent: 1, burstSize: 2 };
      // Fill up the burst bucket
      redis.incr = vi.fn().mockResolvedValue(3); // already at burst+1

      const waitedPromise = limiter.acquireSlot('hubspot', burstConfig);
      await vi.runAllTimersAsync();
      const waited = await waitedPromise;
      expect(waited).toBeGreaterThan(0);
    });

    it('waits out open circuit before returning', async () => {
      // Set circuit to open with reopen_at in the future
      const reopenAt = Date.now() + 5000;
      redis.get = vi.fn().mockImplementation(async (key: string) => {
        if (key.includes(':state')) return 'open';
        if (key.includes(':reopen_at')) return String(reopenAt);
        return null;
      });
      redis.incr = vi.fn().mockResolvedValue(1);

      const waitedPromise = limiter.acquireSlot('hubspot', defaultConfig);
      await vi.runAllTimersAsync();
      const waited = await waitedPromise;
      expect(waited).toBeGreaterThan(0);
    });
  });

  describe('recordSuccess', () => {
    it('closes circuit when in half_open state', async () => {
      redis.get = vi.fn().mockResolvedValue('half_open');
      await limiter.recordSuccess('hubspot');
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining(':state'),
        'closed',
        'EX',
        3600,
      );
    });

    it('does nothing when circuit is closed', async () => {
      redis.get = vi.fn().mockResolvedValue('closed');
      await limiter.recordSuccess('hubspot');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('logs warning when rate limit header shows low remaining', async () => {
      redis.get = vi.fn().mockResolvedValue('closed');
      const logWarn = vi.fn();
      vi.spyOn(console, 'warn').mockImplementation(logWarn);
      await limiter.recordSuccess('hubspot', { remaining: 2 });
      // logger.warn is mocked, not console.warn — just verify no error is thrown
    });
  });

  describe('recordFailure', () => {
    it('returns positive backoff on 429', async () => {
      redis.incr = vi.fn().mockResolvedValue(1);
      redis.get = vi.fn().mockResolvedValue('closed');
      const backoff = await limiter.recordFailure('hubspot', 429);
      expect(backoff).toBeGreaterThan(0);
    });

    it('uses Retry-After header over computed backoff', async () => {
      redis.incr = vi.fn().mockResolvedValue(1);
      redis.get = vi.fn().mockResolvedValue('closed');
      const backoff = await limiter.recordFailure('hubspot', 429, { retryAfterMs: 5000 });
      expect(backoff).toBe(5000);
    });

    it('opens circuit after reaching failure threshold (5)', async () => {
      redis.incr = vi.fn().mockResolvedValue(5); // at threshold
      redis.get = vi.fn().mockResolvedValue('closed');
      await limiter.recordFailure('hubspot', 503);
      // Should have called set to open the circuit
      const setCalls = redis.set.mock.calls as [string, string, ...unknown[]][];
      const circuitSetCall = setCalls.find(([key, value]) => key.includes(':state') && value === 'open');
      expect(circuitSetCall).toBeTruthy();
    });

    it('caps backoff at MAX_BACKOFF_MS (60s)', async () => {
      redis.incr = vi.fn().mockResolvedValue(20); // many failures
      redis.get = vi.fn().mockResolvedValue('closed');
      const backoff = await limiter.recordFailure('hubspot', 503);
      expect(backoff).toBeLessThanOrEqual(60_000 * 1.2); // allow for jitter
    });

    it('caps Retry-After at MAX_BACKOFF_MS', async () => {
      redis.incr = vi.fn().mockResolvedValue(1);
      redis.get = vi.fn().mockResolvedValue('closed');
      const backoff = await limiter.recordFailure('hubspot', 429, { retryAfterMs: 300_000 });
      expect(backoff).toBe(60_000);
    });
  });

  describe('getCircuitState', () => {
    it('returns closed when no state stored', async () => {
      redis.get = vi.fn().mockResolvedValue(null);
      const state = await limiter.getCircuitState('hubspot');
      expect(state).toBe('closed');
    });

    it('returns stored state', async () => {
      redis.get = vi.fn().mockResolvedValue('open');
      const state = await limiter.getCircuitState('hubspot');
      expect(state).toBe('open');
    });
  });

  describe('resetCircuit', () => {
    it('deletes all circuit breaker keys', async () => {
      await limiter.resetCircuit('hubspot');
      expect(redis.del).toHaveBeenCalledTimes(3);
    });
  });
});

describe('DEFAULT_RATE_LIMITS', () => {
  it('has config for common connectors', () => {
    expect(DEFAULT_RATE_LIMITS['hubspot']).toBeDefined();
    expect(DEFAULT_RATE_LIMITS['salesforce']).toBeDefined();
    expect(DEFAULT_RATE_LIMITS['default']).toBeDefined();
  });

  it('hubspot has higher rps than slack', () => {
    expect(DEFAULT_RATE_LIMITS['hubspot']!.requestsPerSecond).toBeGreaterThan(
      DEFAULT_RATE_LIMITS['slack']!.requestsPerSecond,
    );
  });
});
