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

vi.mock('@iris/semantic-core/search-quality-evaluator', () => {
  const mockEvaluator = {
    createExperiment: vi.fn(),
    listExperiments: vi.fn(),
    getResults: vi.fn(),
    promoteExperiment: vi.fn(),
  };
  return {
    SearchQualityEvaluator: vi.fn(() => mockEvaluator),
    _mockEvaluator: mockEvaluator,
  };
});

import { _mockAnalyzer as mockAnalyzer } from '@iris/semantic-core/query-performance-analyzer';
import { _mockEvaluator as mockEvaluator } from '@iris/semantic-core/search-quality-evaluator';
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

  describe('POST /search-experiments', () => {
    it('creates an experiment and returns 201', async () => {
      const exp = { id: 'exp-1', name: 'Hybrid vs Vector', controlStrategy: 'vector', treatmentStrategy: 'hybrid', trafficPct: 50, status: 'running', winner: null };
      mockEvaluator.createExperiment.mockResolvedValueOnce(ok(exp));
      const app = makeApp();
      const res = await app.request('/search-experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hybrid vs Vector', controlStrategy: 'vector', treatmentStrategy: 'hybrid' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof exp };
      expect(body.data.name).toBe('Hybrid vs Vector');
    });

    it('returns 400 on invalid strategy', async () => {
      const app = makeApp();
      const res = await app.request('/search-experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'bad', controlStrategy: 'unknown', treatmentStrategy: 'hybrid' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 on invalid JSON body', async () => {
      const app = makeApp();
      const res = await app.request('/search-experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 on service error', async () => {
      mockEvaluator.createExperiment.mockResolvedValueOnce(err(new Error('db error')));
      const app = makeApp();
      const res = await app.request('/search-experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', controlStrategy: 'vector', treatmentStrategy: 'bm25' }),
      });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /search-experiments', () => {
    it('returns experiment list', async () => {
      const experiments = [{ id: 'exp-1', name: 'Test', status: 'running' }];
      mockEvaluator.listExperiments.mockResolvedValueOnce(ok(experiments));
      const app = makeApp();
      const res = await app.request('/search-experiments');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('passes status filter to evaluator', async () => {
      mockEvaluator.listExperiments.mockResolvedValueOnce(ok([]));
      const app = makeApp();
      await app.request('/search-experiments?status=promoted');
      expect(mockEvaluator.listExperiments).toHaveBeenCalledWith('ws-test', 'promoted');
    });

    it('returns 500 on error', async () => {
      mockEvaluator.listExperiments.mockResolvedValueOnce(err(new Error('db down')));
      const app = makeApp();
      const res = await app.request('/search-experiments');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /search-experiments/:id/results', () => {
    it('returns results for experiment', async () => {
      const results = [{ strategyName: 'vector', metrics: { precisionAtK: 0.8, recallAtK: 0.7, ndcgAtK: 0.75, mrr: 0.9, sampleSize: 100 } }];
      mockEvaluator.getResults.mockResolvedValueOnce(ok(results));
      const app = makeApp();
      const res = await app.request('/search-experiments/exp-1/results');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 500 on error', async () => {
      mockEvaluator.getResults.mockResolvedValueOnce(err(new Error('not found')));
      const app = makeApp();
      const res = await app.request('/search-experiments/exp-404/results');
      expect(res.status).toBe(500);
    });
  });

  describe('PUT /search-experiments/:id/promote', () => {
    it('promotes winner and returns updated experiment', async () => {
      const promoted = { id: 'exp-1', status: 'promoted', winner: 'hybrid' };
      mockEvaluator.promoteExperiment.mockResolvedValueOnce(ok(promoted));
      const app = makeApp();
      const res = await app.request('/search-experiments/exp-1/promote', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner: 'hybrid' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: typeof promoted };
      expect(body.data.winner).toBe('hybrid');
    });

    it('returns 400 when winner is missing', async () => {
      const app = makeApp();
      const res = await app.request('/search-experiments/exp-1/promote', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 on invalid JSON', async () => {
      const app = makeApp();
      const res = await app.request('/search-experiments/exp-1/promote', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when experiment not found', async () => {
      mockEvaluator.promoteExperiment.mockResolvedValueOnce(err(new Error('Experiment not found')));
      const app = makeApp();
      const res = await app.request('/search-experiments/bad-id/promote', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner: 'vector' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 500 on unexpected error', async () => {
      mockEvaluator.promoteExperiment.mockResolvedValueOnce(err(new Error('db crash')));
      const app = makeApp();
      const res = await app.request('/search-experiments/exp-1/promote', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner: 'bm25' }),
      });
      expect(res.status).toBe(500);
    });
  });
});
