import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'hono';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  },
}));

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn(),
  clerkMiddleware: vi.fn(() => async (_c: Context, next: () => Promise<void>) => next()),
}));

import { getAuth } from '@hono/clerk-auth';
import type Redis from 'ioredis';
import { createRateLimiter } from '../middleware/rate-limiter.js';

// ─── Mock Redis pipeline ─────────────────────────────────────────────────────

function makePipeline(cardCount: number) {
  return {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    pexpire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 0],        // zremrangebyscore result
      [null, cardCount], // zcard result
      [null, 1],        // zadd result
      [null, 1],        // pexpire result
    ]),
  };
}

function makeRedis(cardCount: number): Redis {
  const pipeline = makePipeline(cardCount);
  return {
    pipeline: vi.fn().mockReturnValue(pipeline),
  } as unknown as Redis;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeApp(redis: Redis, limit: number, windowMs = 60_000) {
  const app = new Hono();
  app.use('*', createRateLimiter(redis, { limit, windowMs }));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

async function makeRequest(app: Hono, userId: string | null = 'user-123') {
  vi.mocked(getAuth).mockReturnValue(userId ? { userId } as ReturnType<typeof getAuth> : null as unknown as ReturnType<typeof getAuth>);
  return app.request('/test', { method: 'GET' });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createRateLimiter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes through when request count is below limit', async () => {
    const redis = makeRedis(5); // 5 previous requests, limit is 10
    const app = makeApp(redis, 10);
    const res = await makeRequest(app);
    expect(res.status).toBe(200);
  });

  it('returns 429 when request count equals limit', async () => {
    const redis = makeRedis(10); // exactly at limit
    const app = makeApp(redis, 10);
    const res = await makeRequest(app);
    expect(res.status).toBe(429);
  });

  it('returns 429 when request count exceeds limit', async () => {
    const redis = makeRedis(15); // over limit
    const app = makeApp(redis, 10);
    const res = await makeRequest(app);
    expect(res.status).toBe(429);
  });

  it('includes Retry-After header on 429 response', async () => {
    const redis = makeRedis(10);
    const app = makeApp(redis, 10, 60_000); // 60s window
    const res = await makeRequest(app);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('returns error envelope on 429', async () => {
    const redis = makeRedis(10);
    const app = makeApp(redis, 10);
    const res = await makeRequest(app);
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toContain('Too many requests');
  });

  it('builds Redis key using userId', async () => {
    const redis = makeRedis(0);
    const app = makeApp(redis, 10);
    await makeRequest(app, 'user-abc');
    expect(redis.pipeline).toHaveBeenCalledOnce();
    const pipeline = vi.mocked(redis.pipeline).mock.results[0]?.value;
    expect(pipeline.zadd).toHaveBeenCalledWith(
      expect.stringContaining('user-abc'),
      expect.any(Number),
      expect.any(String),
    );
  });

  it('uses keyScope in Redis key', async () => {
    const redis = makeRedis(0);
    const app = new Hono();
    app.use('*', createRateLimiter(redis, { limit: 10, windowMs: 60_000, keyScope: 'sync' }));
    app.get('/test', (c) => c.json({ ok: true }));
    vi.mocked(getAuth).mockReturnValue({ userId: 'user-1' } as ReturnType<typeof getAuth>);
    await app.request('/test', { method: 'GET' });
    const pipeline = vi.mocked(redis.pipeline).mock.results[0]?.value;
    expect(pipeline.zadd).toHaveBeenCalledWith(
      expect.stringContaining('sync'),
      expect.any(Number),
      expect.any(String),
    );
  });

  it('passes through without rate-checking when userId is absent', async () => {
    const redis = makeRedis(999); // would exceed any limit
    const app = makeApp(redis, 10);
    const res = await makeRequest(app, null); // no userId
    expect(res.status).toBe(200); // passes through
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it('fails open when Redis pipeline throws', async () => {
    const pipeline = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
    };
    const redis = { pipeline: vi.fn().mockReturnValue(pipeline) } as unknown as Redis;
    const app = makeApp(redis, 10);
    const res = await makeRequest(app);
    expect(res.status).toBe(200); // fail open
  });

  it('prunes old entries via zremrangebyscore', async () => {
    const redis = makeRedis(0);
    const app = makeApp(redis, 10, 30_000);
    await makeRequest(app);
    const pipeline = vi.mocked(redis.pipeline).mock.results[0]?.value;
    expect(pipeline.zremrangebyscore).toHaveBeenCalledWith(
      expect.any(String),
      0,
      expect.any(Number),
    );
  });

  it('sets TTL via pexpire', async () => {
    const redis = makeRedis(0);
    const app = makeApp(redis, 10, 30_000);
    await makeRequest(app);
    const pipeline = vi.mocked(redis.pipeline).mock.results[0]?.value;
    expect(pipeline.pexpire).toHaveBeenCalledWith(expect.any(String), 30_000);
  });
});
