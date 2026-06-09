import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

const mockEnforce = vi.hoisted(() => vi.fn());

vi.mock('@iris/semantic-core/rate-limiter', () => ({
  RateLimitService: class {
    enforceRateLimit = mockEnforce;
  },
  TIER_LIMITS: {
    free: { requestsPerMinute: 60 },
  },
}));

import { rateLimitMiddleware } from '../../middleware/rate-limiting.js';

function allowed(remaining = 99) {
  return { isOk: () => true, value: { allowed: true, retryAfterMs: null, remaining } };
}

function limited(retryAfterMs = 30_000) {
  return { isOk: () => true, value: { allowed: false, retryAfterMs, remaining: 0 } };
}

function failed() {
  return { isOk: () => false };
}

function makeSql() {
  return vi.fn() as unknown as Parameters<typeof rateLimitMiddleware>[0];
}

function makeApp(options = {}) {
  const app = new Hono();
  app.use('*', rateLimitMiddleware(makeSql(), options));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimitMiddleware', () => {
  it('allows requests when within limit', async () => {
    mockEnforce.mockResolvedValueOnce(allowed(50));
    const res = await makeApp().request('/test');
    expect(res.status).toBe(200);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockEnforce.mockResolvedValueOnce(limited(30_000));
    const res = await makeApp().request('/test');
    expect(res.status).toBe(429);
  });

  it('returns rate_limited error code on 429', async () => {
    mockEnforce.mockResolvedValueOnce(limited(5_000));
    const res = await makeApp().request('/test');
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('includes Retry-After header when rate limited', async () => {
    mockEnforce.mockResolvedValueOnce(limited(15_000));
    const res = await makeApp().request('/test');
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(parseInt(retryAfter!, 10)).toBeGreaterThan(0);
  });

  it('includes X-RateLimit-Remaining header', async () => {
    mockEnforce.mockResolvedValueOnce(allowed(42));
    const res = await makeApp().request('/test', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('42');
  });

  it('includes X-RateLimit-Limit header reflecting the configured limit', async () => {
    mockEnforce.mockResolvedValueOnce(allowed(10));
    const res = await makeApp({ limitPerWindow: 100 }).request('/test');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
  });

  it('reads workspace ID from x-workspace-id header', async () => {
    mockEnforce.mockResolvedValueOnce(allowed(5));
    await makeApp().request('/test', { headers: { 'x-workspace-id': 'ws-custom' } });
    expect(mockEnforce).toHaveBeenCalledWith('ws-custom', expect.any(String), expect.any(Number), expect.any(Number));
  });

  it('falls through gracefully when enforceRateLimit returns err', async () => {
    mockEnforce.mockResolvedValueOnce(failed());
    const res = await makeApp().request('/test');
    expect(res.status).toBe(200);
  });
});
