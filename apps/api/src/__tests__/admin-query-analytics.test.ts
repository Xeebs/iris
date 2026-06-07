import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAdminQueryAnalyticsRoutes } from '../routes/admin-query-analytics.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/query-performance-analyzer', () => {
  const mockAnalyzer = {
    analyzeSlowQueries: vi.fn(),
    analyzeQueryPatterns: vi.fn(),
    optimizeVectorIndex: vi.fn(),
  };
  return {
    QueryPerformanceAnalyzer: vi.fn(() => mockAnalyzer),
    _mockAnalyzer: mockAnalyzer,
  };
});

import { _mockAnalyzer as mockAnalyzer } from '@iris/semantic-core/query-performance-analyzer';
import { ok, err } from 'neverthrow';

const mockSqlFn = vi.fn((..._args: unknown[]) => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/', createAdminQueryAnalyticsRoutes(mockSqlFn));
  return app;
}

describe('admin-query-analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /queries/slow', () => {
    it('returns list of slow queries', async () => {
      const mockSlowQueries = [
        { queryHash: 'abc', queryText: 'find contacts', p50Ms: 500, p95Ms: 2000, callCount: 10, avgResultSize: 5 },
      ];
      mockAnalyzer.analyzeSlowQueries.mockResolvedValueOnce(ok(mockSlowQueries));
      const app = makeApp();
      const res = await app.request('/queries/slow');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('respects limit and days query params', async () => {
      mockAnalyzer.analyzeSlowQueries.mockResolvedValueOnce(ok([]));
      const app = makeApp();
      await app.request('/queries/slow?limit=5&days=14');
      expect(mockAnalyzer.analyzeSlowQueries).toHaveBeenCalledWith('ws-test', 5, 14);
    });

    it('clamps limit to 50', async () => {
      mockAnalyzer.analyzeSlowQueries.mockResolvedValueOnce(ok([]));
      const app = makeApp();
      await app.request('/queries/slow?limit=999');
      expect(mockAnalyzer.analyzeSlowQueries).toHaveBeenCalledWith('ws-test', 50, 7);
    });

    it('returns 500 on service error', async () => {
      mockAnalyzer.analyzeSlowQueries.mockResolvedValueOnce(err(new Error('db timeout')));
      const app = makeApp();
      const res = await app.request('/queries/slow');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /queries/patterns', () => {
    it('returns entity access heatmap', async () => {
      const mockPatterns = [
        { entityId: 'hubspot:contact:1', accessCount: 42, lastAccessed: new Date() },
        { entityId: 'hubspot:company:5', accessCount: 18, lastAccessed: new Date() },
      ];
      mockAnalyzer.analyzeQueryPatterns.mockResolvedValueOnce(ok(mockPatterns));
      const app = makeApp();
      const res = await app.request('/queries/patterns');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(2);
    });

    it('returns 500 on service error', async () => {
      mockAnalyzer.analyzeQueryPatterns.mockResolvedValueOnce(err(new Error('query failed')));
      const app = makeApp();
      const res = await app.request('/queries/patterns');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /index-recommendations', () => {
    it('returns prioritized recommendations', async () => {
      const mockRecs = [
        {
          type: 'ivfflat_lists',
          priority: 'high',
          description: 'Increase IVFFlat list count',
          estimatedImpact: '30-50% reduction',
          sqlHint: 'CREATE INDEX ...',
        },
      ];
      mockAnalyzer.optimizeVectorIndex.mockResolvedValueOnce(ok(mockRecs));
      const app = makeApp();
      const res = await app.request('/index-recommendations');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 500 on service error', async () => {
      mockAnalyzer.optimizeVectorIndex.mockResolvedValueOnce(err(new Error('stats failed')));
      const app = makeApp();
      const res = await app.request('/index-recommendations');
      expect(res.status).toBe(500);
    });
  });
});
