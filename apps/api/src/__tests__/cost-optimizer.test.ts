import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';
import { createCostOptimizerRoutes } from '../routes/cost-optimizer.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const mockAdvisor = {
  analyzeSpendPatterns: vi.fn(),
  generateRecommendations: vi.fn(),
  applyRecommendation: vi.fn(),
};

vi.mock('@iris/semantic-core/cost-optimizer', () => ({
  CostOptimizationAdvisor: vi.fn().mockImplementation(() => mockAdvisor),
  estimateMonthlySavings: vi.fn(),
  rankRecommendations: vi.fn((v: unknown) => v),
  filterLowEffort: vi.fn((v: unknown) => v),
}));

const WS = 'ws-test-opt';

const spendPattern = {
  workspaceId: WS,
  windowDays: 30,
  totalTokensSpent: 500000,
  totalCostCents: 750,
  avgTokensPerQuery: 333,
  avgCostPerQuery: 0.5,
  cacheHitRate: 0.05,
  compressionEfficiency: 0.2,
  tokensPerDay: 16667,
  costPerDay: 25,
  topQueriesByTokens: [],
};

const recommendations = [
  {
    id: 'enable_semantic_cache',
    type: 'enable_semantic_cache',
    title: 'Enable semantic cache',
    description: 'Low cache hit rate',
    estimatedSavingsTokensPerDay: 5000,
    estimatedSavingsCostMonthly: 225,
    implementationEffort: 'low',
    appliedAt: null,
    savingsRealizedCents: 0,
  },
];

function makeApp(): Hono {
  const app = new Hono();
  const fakeSql = vi.fn() as unknown as Parameters<typeof createCostOptimizerRoutes>[0];
  app.use('*', async (c, next) => { c.set('workspaceId', WS); await next(); });
  app.route('/cost-optimizer', createCostOptimizerRoutes(fakeSql));
  return app;
}

describe('Cost Optimizer Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdvisor.analyzeSpendPatterns.mockResolvedValue(ok(spendPattern));
    mockAdvisor.generateRecommendations.mockResolvedValue(ok(recommendations));
    mockAdvisor.applyRecommendation.mockResolvedValue(ok(undefined));
    app = makeApp();
  });

  describe('GET /cost-optimizer/recommendations', () => {
    it('returns 200 with spend summary and recommendations', async () => {
      const res = await app.request('/cost-optimizer/recommendations');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { spendSummary: unknown; recommendations: unknown[] } };
      expect(body.data.spendSummary).toBeDefined();
      expect(Array.isArray(body.data.recommendations)).toBe(true);
    });

    it('calls analyzeSpendPatterns with default windowDays=30', async () => {
      await app.request('/cost-optimizer/recommendations');
      expect(mockAdvisor.analyzeSpendPatterns).toHaveBeenCalledWith(WS, 30);
    });

    it('passes custom windowDays from query param', async () => {
      await app.request('/cost-optimizer/recommendations?windowDays=14');
      expect(mockAdvisor.analyzeSpendPatterns).toHaveBeenCalledWith(WS, 14);
    });

    it('returns 400 for invalid windowDays', async () => {
      const res = await app.request('/cost-optimizer/recommendations?windowDays=-1');
      expect(res.status).toBe(400);
    });

    it('returns 400 for windowDays > 365', async () => {
      const res = await app.request('/cost-optimizer/recommendations?windowDays=400');
      expect(res.status).toBe(400);
    });

    it('returns 500 when analyzeSpendPatterns fails', async () => {
      mockAdvisor.analyzeSpendPatterns.mockResolvedValue(err(new Error('DB fail')));
      const res = await app.request('/cost-optimizer/recommendations');
      expect(res.status).toBe(500);
    });

    it('returns 500 when generateRecommendations fails', async () => {
      mockAdvisor.generateRecommendations.mockResolvedValue(err(new Error('failed')));
      const res = await app.request('/cost-optimizer/recommendations');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /cost-optimizer/apply', () => {
    it('returns 200 on successful apply', async () => {
      const res = await app.request('/cost-optimizer/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendationId: 'enable_semantic_cache' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { applied: boolean; recommendationId: string } };
      expect(body.data.applied).toBe(true);
      expect(body.data.recommendationId).toBe('enable_semantic_cache');
    });

    it('returns 400 when body is missing', async () => {
      const res = await app.request('/cost-optimizer/apply', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when recommendationId is missing', async () => {
      const res = await app.request('/cost-optimizer/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('passes savingsRealizedCents to applyRecommendation', async () => {
      await app.request('/cost-optimizer/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendationId: 'archive_stale_entities', savingsRealizedCents: 150 }),
      });
      expect(mockAdvisor.applyRecommendation).toHaveBeenCalledWith(WS, 'archive_stale_entities', 150);
    });

    it('returns 500 when apply fails', async () => {
      mockAdvisor.applyRecommendation.mockResolvedValue(err(new Error('DB error')));
      const res = await app.request('/cost-optimizer/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendationId: 'enable_semantic_cache' }),
      });
      expect(res.status).toBe(500);
    });
  });
});
