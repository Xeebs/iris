import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockEngine = {
  analyzePatterns: vi.fn(),
  predictCacheWarmingJobs: vi.fn(),
  getPatterns: vi.fn().mockResolvedValue([]),
  trackQuery: vi.fn().mockResolvedValue(undefined),
  detectQueryPatterns: vi.fn().mockResolvedValue([]),
  warmCache: vi.fn().mockResolvedValue({ warmingJobId: 'job-1', triggerQuerySignatures: [] }),
  getTopSignatures: vi.fn().mockResolvedValue([]),
  getRecentEvents: vi.fn().mockResolvedValue([]),
};

vi.mock('@iris/semantic-core/query-analytics-engine', () => ({
  QueryAnalyticsEngine: vi.fn(() => mockEngine),
  computeQuerySignature: vi.fn((q: string) => Buffer.from(q).toString('hex').slice(0, 16)),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createQueryAnalyticsRoutes } = await import('../routes/query-analytics.js');
  return createQueryAnalyticsRoutes;
}

const SAMPLE_PATTERNS = [
  { signature: 'abc123', queryText: 'show me deals', frequency: 10, avgLatencyMs: 120, cacheHitRate: 0.6 },
];

describe('query-analytics routes', () => {
  let createQueryAnalyticsRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createQueryAnalyticsRoutes = await importRoutes();
  });

  function makeSql(returnValue: unknown[] = []) {
    return vi.fn().mockResolvedValue(returnValue) as unknown as Parameters<typeof createQueryAnalyticsRoutes>[0];
  }

  function buildApp(sqlMock: ReturnType<typeof makeSql>) {
    const app = new Hono();
    app.route('/query-analytics', createQueryAnalyticsRoutes(sqlMock));
    return app;
  }

  function reqWithWorkspace(path: string, opts: RequestInit = {}) {
    return new Request(`http://localhost${path}`, {
      ...opts,
      headers: { 'x-workspace-id': 'ws-1', ...(opts.headers as Record<string, string> ?? {}) },
    });
  }

  describe('GET /', () => {
    it('returns 200 with analytics summary', async () => {
      const sql = makeSql([]);
      const res = await buildApp(sql).fetch(reqWithWorkspace('/query-analytics'));
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { summary: { totalQueries: number } } };
      expect(body.data.summary).toBeDefined();
    });

    it('returns 401 without workspace header', async () => {
      const app = buildApp(makeSql());
      const res = await app.request('/query-analytics');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /patterns', () => {
    it('returns 200 with query patterns', async () => {
      const sql = makeSql(SAMPLE_PATTERNS);
      const res = await buildApp(sql).fetch(reqWithWorkspace('/query-analytics/patterns'));
      expect(res.status).toBe(200);
    });

    it('returns 401 without workspace header', async () => {
      const res = await buildApp(makeSql()).request('/query-analytics/patterns');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /track', () => {
    it('tracks a query event and returns 200', async () => {
      const sql = makeSql([]);
      const res = await buildApp(sql).fetch(new Request('http://localhost/query-analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
        body: JSON.stringify({ queryText: 'show deals', cacheHit: false, latencyMs: 100, tokensSpent: 200 }),
      }));
      expect(res.status).toBe(200);
    });

    it('returns 400 when queryText missing', async () => {
      const res = await buildApp(makeSql()).fetch(new Request('http://localhost/query-analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
        body: JSON.stringify({ cacheHit: false }),
      }));
      expect(res.status).toBe(400);
    });
  });
});
