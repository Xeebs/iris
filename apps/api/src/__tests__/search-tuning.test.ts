import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSearchTuningRoutes } from '../routes/search-tuning.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/relevance-tuner', () => {
  const methods = {
    recordFeedback: vi.fn(),
    loadWeights: vi.fn(),
    updateWeight: vi.fn(),
    resetWeights: vi.fn(),
    analyzeFeedback: vi.fn(),
  };
  return { RelevanceTuner: vi.fn(() => methods) };
});

import { RelevanceTuner } from '@iris/semantic-core/relevance-tuner';

function getTunerMock() {
  const RT = RelevanceTuner as unknown as { mock: { results: Array<{ value: Record<string, ReturnType<typeof vi.fn>> }> } };
  return RT.mock.results[0]!.value;
}

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
  app.route('/', createSearchTuningRoutes(sql));
  return app;
}

describe('search-tuning routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('POST /feedback', () => {
    it('records feedback and returns 201', async () => {
      const app = makeApp();
      getTunerMock().recordFeedback.mockResolvedValueOnce(undefined);

      const res = await app.request('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'find contacts', clickedEntityId: 'e-1', rank: 2, feedbackScore: 1.0 }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { recorded: boolean } };
      expect(body.data.recorded).toBe(true);
    });

    it('returns 400 on missing required fields', async () => {
      const app = makeApp();
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'q' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 when workspaceId missing', async () => {
      const app = new Hono();
      const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
      app.route('/', createSearchTuningRoutes(sql));
      const res = await app.request('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(401);
    });

    it('returns 500 on DB error', async () => {
      const app = makeApp();
      getTunerMock().recordFeedback.mockRejectedValueOnce(new Error('db error'));
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'q', clickedEntityId: 'e', rank: 1 }),
      });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /weights', () => {
    it('returns current weights', async () => {
      const app = makeApp();
      const weights = { bm25_weight: 0.3, embedding_weight: 0.7, type_boost_contact: 1.0, type_boost_deal: 1.0, type_boost_company: 1.0, recency_boost: 0.1, relationship_distance_penalty: 0.05 };
      getTunerMock().loadWeights.mockResolvedValueOnce(weights);
      const res = await app.request('/weights');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: typeof weights };
      expect(body.data.bm25_weight).toBe(0.3);
    });

    it('returns 401 when workspaceId missing', async () => {
      const app = new Hono();
      const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
      app.route('/', createSearchTuningRoutes(sql));
      const res = await app.request('/weights');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /weights', () => {
    it('updates weight and returns new config', async () => {
      const app = makeApp();
      const tuner = getTunerMock();
      tuner.updateWeight.mockResolvedValueOnce(undefined);
      tuner.loadWeights.mockResolvedValueOnce({ bm25_weight: 0.4, embedding_weight: 0.6, type_boost_contact: 1.0, type_boost_deal: 1.0, type_boost_company: 1.0, recency_boost: 0.1, relationship_distance_penalty: 0.05 });
      const res = await app.request('/weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorName: 'bm25_weight', tunedValue: 0.4 }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 422 on validation error from tuner', async () => {
      const app = makeApp();
      getTunerMock().updateWeight.mockRejectedValueOnce(new Error('bm25_weight must be non-negative'));
      const res = await app.request('/weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorName: 'bm25_weight', tunedValue: -0.5 }),
      });
      expect(res.status).toBe(422);
    });

    it('returns 400 on invalid factorName', async () => {
      const app = makeApp();
      const res = await app.request('/weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorName: 'invalid_factor', tunedValue: 0.5 }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /weights', () => {
    it('resets weights and returns success', async () => {
      const app = makeApp();
      getTunerMock().resetWeights.mockResolvedValueOnce(undefined);
      const res = await app.request('/weights', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { reset: boolean } };
      expect(body.data.reset).toBe(true);
    });
  });

  describe('GET /analytics', () => {
    it('returns feedback analytics', async () => {
      const app = makeApp();
      const data = [{ query: 'contacts', avgRank: 2.5, clickCount: 10, avgDwellMs: 3000 }];
      getTunerMock().analyzeFeedback.mockResolvedValueOnce(data);
      const res = await app.request('/analytics');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: typeof data };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.clickCount).toBe(10);
    });

    it('clamps days to 90', async () => {
      const app = makeApp();
      getTunerMock().analyzeFeedback.mockResolvedValueOnce([]);
      await app.request('/analytics?days=999');
      expect(getTunerMock().analyzeFeedback).toHaveBeenCalledWith('ws-test', 90);
    });
  });
});
