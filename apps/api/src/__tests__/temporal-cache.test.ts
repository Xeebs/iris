import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeTemporalCacheRouter } from '../routes/temporal-cache.js';

vi.mock('@iris/semantic-core/temporal-query-cache', () => {
  const ok = (v: unknown) => ({ isOk: () => true, isErr: () => false, value: v });
  const er = (m: string) => ({ isOk: () => false, isErr: () => true, error: new Error(m) });

  const MockService = vi.fn().mockImplementation(() => ({
    queryAsOfDate: vi.fn().mockResolvedValue(ok({
      queryId: 'cache-1',
      queryHash: 'abc12345',
      result: { entities: [] },
      asOfDate: new Date('2026-06-08'),
      expiresAt: new Date('2026-06-09'),
      hitCount: 2,
      createdAt: new Date('2026-06-08'),
    })),
    analyzeCacheHits: vi.fn().mockResolvedValue(ok({
      intervalDays: 7,
      totalRequests: 100,
      hitCount: 75,
      missCount: 25,
      hitRate: 0.75,
      topMissedQueries: [{ queryHash: 'abc12345', missCount: 10, lastMissedAt: new Date() }],
      missPatterns: [{ reason: 'no_entry', count: 25 }],
    })),
    warmCacheProactively: vi.fn().mockResolvedValue(ok({
      warmed: 3,
      skipped: 2,
      candidates: [{ queryHash: 'h1', accessCount: 10 }, { queryHash: 'h2', accessCount: 7 }],
    })),
    _er: er,
  }));

  return { TemporalQueryCache: MockService };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp() {
  const app = new Hono();
  app.route('/api/v1', makeTemporalCacheRouter(makeSql()));
  return app;
}

describe('GET /cache/temporal/:queryId/:date', () => {
  it('returns cached result for valid query and date', async () => {
    const res = await buildApp().request('/api/v1/cache/temporal/find%20contacts/2026-06-08');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { queryId: string } };
    expect(body.data.queryId).toBe('cache-1');
  });

  it('returns 400 for invalid date format', async () => {
    const res = await buildApp().request('/api/v1/cache/temporal/find%20contacts/not-a-date');
    expect(res.status).toBe(400);
  });

  it('returns 404 when no cache entry found', async () => {
    const { TemporalQueryCache } = await import('@iris/semantic-core/temporal-query-cache');
    vi.mocked(TemporalQueryCache).mockImplementationOnce(() => ({
      queryAsOfDate: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: null }),
      analyzeCacheHits: vi.fn(),
      warmCacheProactively: vi.fn(),
      evictExpired: vi.fn(),
    }));
    const app = new Hono();
    app.route('/api/v1', makeTemporalCacheRouter(makeSql()));
    const res = await app.request('/api/v1/cache/temporal/unknown-query/2026-06-01');
    expect(res.status).toBe(404);
  });

  it('returns 500 on service error', async () => {
    const { TemporalQueryCache } = await import('@iris/semantic-core/temporal-query-cache');
    vi.mocked(TemporalQueryCache).mockImplementationOnce(() => ({
      queryAsOfDate: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('db error') }),
      analyzeCacheHits: vi.fn(),
      warmCacheProactively: vi.fn(),
      evictExpired: vi.fn(),
    }));
    const app = new Hono();
    app.route('/api/v1', makeTemporalCacheRouter(makeSql()));
    const res = await app.request('/api/v1/cache/temporal/find%20contacts/2026-06-08');
    expect(res.status).toBe(500);
  });
});

describe('GET /cache/analytics', () => {
  it('returns analytics with default intervalDays', async () => {
    const res = await buildApp().request('/api/v1/cache/analytics');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { hitRate: number; intervalDays: number } };
    expect(body.data.hitRate).toBeCloseTo(0.75);
    expect(body.data.intervalDays).toBe(7);
  });

  it('accepts custom intervalDays', async () => {
    const res = await buildApp().request('/api/v1/cache/analytics?intervalDays=14');
    expect(res.status).toBe(200);
  });

  it('returns 400 for out-of-range intervalDays', async () => {
    const res = await buildApp().request('/api/v1/cache/analytics?intervalDays=200');
    expect(res.status).toBe(400);
  });
});

describe('POST /cache/preload', () => {
  it('triggers cache warming with default interval', async () => {
    const res = await buildApp().request('/api/v1/cache/preload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { warmed: number; skipped: number } };
    expect(body.data.warmed).toBe(3);
    expect(body.data.skipped).toBe(2);
  });

  it('accepts custom intervalDays', async () => {
    const res = await buildApp().request('/api/v1/cache/preload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalDays: 7 }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid intervalDays', async () => {
    const res = await buildApp().request('/api/v1/cache/preload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalDays: 0 }),
    });
    expect(res.status).toBe(400);
  });
});
