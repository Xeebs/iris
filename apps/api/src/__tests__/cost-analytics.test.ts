import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createCostAnalyticsRoutes } from '../routes/cost-analytics.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/cost-optimizer', () => {
  const methods = {
    attributeCosts: vi.fn(),
    recommend: vi.fn(),
    applyRecommendation: vi.fn(),
  };
  return { CostOptimizationAdvisor: vi.fn(() => methods) };
});

import { CostOptimizationAdvisor } from '@iris/semantic-core/cost-optimizer';
import { ok } from 'neverthrow';

function getAdvisorMock() {
  const CA = CostOptimizationAdvisor as unknown as { mock: { results: Array<{ value: Record<string, ReturnType<typeof vi.fn>> }> } };
  return CA.mock.results[0]!.value;
}

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
  app.route('/', createCostAnalyticsRoutes(sql));
  return app;
}

describe('cost-analytics routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('GET /breakdown', () => {
    it('returns cost breakdown', async () => {
      const app = makeApp();
      const breakdown = {
        byConnector: [{ connectorId: 'gdrive-1', tokensSpent: 5000, pctOfTotal: 75 }],
        byEntityType: [{ entityType: 'contact', tokensSpent: 3000, pctOfTotal: 60 }],
        weekOverWeekChange: 5.0,
      };
      getAdvisorMock().attributeCosts.mockResolvedValueOnce(breakdown);
      const res = await app.request('/breakdown');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: typeof breakdown };
      expect(body.data.byConnector).toHaveLength(1);
      expect(body.data.weekOverWeekChange).toBe(5.0);
    });

    it('returns 401 when workspaceId missing', async () => {
      const app = new Hono();
      const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
      app.route('/', createCostAnalyticsRoutes(sql));
      const res = await app.request('/breakdown');
      expect(res.status).toBe(401);
    });

    it('returns 500 on error', async () => {
      const app = makeApp();
      getAdvisorMock().attributeCosts.mockRejectedValueOnce(new Error('db error'));
      const res = await app.request('/breakdown');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /recommendations', () => {
    it('returns ranked recommendations', async () => {
      const app = makeApp();
      const recs = [
        { id: 'enable_semantic_cache', title: 'Enable cache', description: '...', estimatedSavingsCostMonthly: 500, implementationEffort: 'low', appliedAt: null, savingsRealizedCents: 0 },
      ];
      getAdvisorMock().recommend.mockResolvedValueOnce(ok(recs));
      const res = await app.request('/recommendations');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: typeof recs };
      expect(body.data).toHaveLength(1);
    });

    it('returns 401 when workspaceId missing', async () => {
      const app = new Hono();
      const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
      app.route('/', createCostAnalyticsRoutes(sql));
      const res = await app.request('/recommendations');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /recommendations/:id/apply', () => {
    it('applies a recommendation', async () => {
      const app = makeApp();
      getAdvisorMock().applyRecommendation.mockResolvedValueOnce(ok(undefined));
      const res = await app.request('/recommendations/enable_semantic_cache/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ savingsRealizedCents: 150 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { applied: boolean } };
      expect(body.data.applied).toBe(true);
    });

    it('returns 401 when workspaceId missing', async () => {
      const app = new Hono();
      const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
      app.route('/', createCostAnalyticsRoutes(sql));
      const res = await app.request('/recommendations/enable_semantic_cache/apply', { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });
});
