import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';

import { createQuotaMiddleware } from '../middleware/quota-manager.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@hono/clerk-auth', () => ({
  getAuth: () => ({ userId: 'user-123' }),
}));

function makeRedis(evalResult: [number, number, number] = [1, 9, 0]): InstanceType<typeof Redis> {
  return {
    eval: vi.fn().mockResolvedValue(evalResult),
  } as unknown as InstanceType<typeof Redis>;
}

function makeApp(redis: InstanceType<typeof Redis>, opts = { limit: 10, windowMs: 60_000, scope: 'test' }) {
  const app = new Hono();
  app.use('*', createQuotaMiddleware(redis, opts));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('createQuotaMiddleware', () => {
  it('allows request when quota not exceeded', async () => {
    const redis = makeRedis([1, 9, 0]);
    const app = makeApp(redis);
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 429 when quota exceeded', async () => {
    const redis = makeRedis([0, 0, 5000]);
    const app = makeApp(redis);
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('sets X-RateLimit-Limit header', async () => {
    const redis = makeRedis([1, 9, 0]);
    const app = makeApp(redis);
    const res = await app.request('/test');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
  });

  it('sets X-RateLimit-Remaining header reflecting remaining tokens', async () => {
    const redis = makeRedis([1, 7, 0]);
    const app = makeApp(redis);
    const res = await app.request('/test');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('7');
  });

  it('sets Retry-After header when rate limited', async () => {
    const redis = makeRedis([0, 0, 2000]);
    const app = makeApp(redis);
    const res = await app.request('/test');
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('sets X-RateLimit-Reset header', async () => {
    const redis = makeRedis([1, 5, 0]);
    const app = makeApp(redis);
    const res = await app.request('/test');
    const resetTs = Number(res.headers.get('X-RateLimit-Reset'));
    expect(resetTs).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('fails open when Redis throws', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('Redis down')) } as unknown as InstanceType<typeof Redis>;
    const app = makeApp(redis);
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('calls Redis eval with correct burst limit', async () => {
    const redis = makeRedis([1, 14, 0]);
    const opts = { limit: 10, windowMs: 60_000, scope: 'test', burstMultiplier: 1.5 };
    const app = makeApp(redis, opts);
    await app.request('/test');
    const evalArgs = (redis.eval as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    // ARGV[2] is burst_limit = limit * burstMultiplier = 15
    expect(Number(evalArgs[4])).toBe(15);
  });

  it('uses custom scope in Redis key', async () => {
    const redis = makeRedis([1, 9, 0]);
    const opts = { limit: 100, windowMs: 60_000, scope: 'webhook' };
    const app = makeApp(redis, opts);
    await app.request('/test');
    const evalArgs = (redis.eval as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(String(evalArgs[2])).toContain('quota:webhook:user-123');
  });

  it('error message contains scope name', async () => {
    const redis = makeRedis([0, 0, 3000]);
    const opts = { limit: 5, windowMs: 60_000, scope: 'sync' };
    const app = makeApp(redis, opts);
    const res = await app.request('/test');
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain('sync');
  });
});
