import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createQuotaMiddleware } from '../../middleware/quota-manager.js';

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn().mockReturnValue({ userId: 'user_123' }),
  createMiddleware: (fn: unknown) => fn,
}));

function makeRedis(evalResult: [number, number, number] = [1, 9, 0]) {
  return {
    eval: vi.fn().mockResolvedValue(evalResult),
  } as unknown as import('ioredis').Redis;
}

function makeApp(redis: import('ioredis').Redis, limit = 10) {
  const app = new Hono();
  app.use('*', createQuotaMiddleware(redis, { limit, windowMs: 60_000, scope: 'test' }));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('createQuotaMiddleware', () => {
  it('allows request when quota is available', async () => {
    const redis = makeRedis([1, 9, 0]);
    const res = await makeApp(redis).request('/test');
    expect(res.status).toBe(200);
  });

  it('returns 429 when quota is exhausted', async () => {
    const redis = makeRedis([0, 0, 5000]);
    const res = await makeApp(redis).request('/test');
    expect(res.status).toBe(429);
  });

  it('returns RATE_LIMITED error code on 429', async () => {
    const redis = makeRedis([0, 0, 3000]);
    const res = await makeApp(redis).request('/test');
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('includes Retry-After header when quota exceeded', async () => {
    const redis = makeRedis([0, 0, 5000]);
    const res = await makeApp(redis).request('/test');
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
  });

  it('includes X-RateLimit-Remaining header', async () => {
    const redis = makeRedis([1, 7, 0]);
    const res = await makeApp(redis).request('/test');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('7');
  });

  it('includes X-RateLimit-Limit header reflecting the configured limit', async () => {
    const redis = makeRedis([1, 5, 0]);
    const res = await makeApp(redis, 20).request('/test');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
  });

  it('includes X-RateLimit-Reset header', async () => {
    const redis = makeRedis([1, 5, 0]);
    const res = await makeApp(redis).request('/test');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('skips quota check when userId is absent (unauthenticated)', async () => {
    const { getAuth } = await import('@hono/clerk-auth');
    vi.mocked(getAuth).mockReturnValueOnce(null);
    const redis = makeRedis([0, 0, 5000]);
    const res = await makeApp(redis).request('/test');
    expect(res.status).toBe(200);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('fails open when Redis eval throws', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('Redis down')) } as unknown as import('ioredis').Redis;
    const res = await makeApp(redis).request('/test');
    expect(res.status).toBe(200);
  });
});
