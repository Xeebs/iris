import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createRelevanceRoutes } from '../routes/relevance.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const defaultWeights = {
  bm25_weight: 0.3, embedding_weight: 0.7,
  type_boost_contact: 1.0, type_boost_deal: 1.0, type_boost_company: 1.0,
  recency_boost: 0.1, relationship_distance_penalty: 0.05,
};

vi.mock('@iris/semantic-core/relevance-tuner', () => ({
  DEFAULT_WEIGHTS: {
    bm25_weight: 0.3, embedding_weight: 0.7,
    type_boost_contact: 1.0, type_boost_deal: 1.0, type_boost_company: 1.0,
    recency_boost: 0.1, relationship_distance_penalty: 0.05,
  },
  RelevanceTuner: vi.fn().mockImplementation(() => ({
    loadWeights: vi.fn().mockResolvedValue({ ...defaultWeights }),
    updateWeight: vi.fn().mockResolvedValue(undefined),
    recordFeedback: vi.fn().mockResolvedValue(undefined),
    analyzeFeedback: vi.fn().mockResolvedValue([
      { query: 'find contacts', avgRank: 2.5, clickCount: 10, avgDwellMs: 3000 },
    ]),
    resetWeights: vi.fn().mockResolvedValue(undefined),
  })),
}));

function makeApp() {
  const sql = vi.fn().mockResolvedValue([]);
  const app = new Hono();
  app.route('/api/v1/admin/relevance', createRelevanceRoutes(sql as never));
  return { app, sql };
}

describe('GET /api/v1/admin/relevance/weights', () => {
  it('returns current weights', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/admin/relevance/weights', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { weights: typeof defaultWeights; defaults: typeof defaultWeights; factorNames: string[] } };
    expect(body.data.weights.embedding_weight).toBe(0.7);
    expect(Array.isArray(body.data.factorNames)).toBe(true);
    expect(body.data.factorNames).toContain('bm25_weight');
  });

  it('returns 500 on DB error', async () => {
    const { RelevanceTuner } = await import('@iris/semantic-core/relevance-tuner');
    vi.mocked(RelevanceTuner).mockImplementationOnce(() => ({
      loadWeights: vi.fn().mockRejectedValue(new Error('db error')),
      updateWeight: vi.fn(), recordFeedback: vi.fn(), analyzeFeedback: vi.fn(), resetWeights: vi.fn(),
    }));
    const sql = vi.fn();
    const app = new Hono();
    app.route('/api/v1/admin/relevance', createRelevanceRoutes(sql as never));
    const res = await app.request('/api/v1/admin/relevance/weights', { headers: { 'x-workspace-id': 'ws1' } });
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/v1/admin/relevance/weights', () => {
  it('updates a weight and returns new weights', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/admin/relevance/weights', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ factorName: 'recency_boost', value: 0.2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { weights: typeof defaultWeights } };
    expect(body.data.weights).toBeDefined();
  });

  it('returns 400 for unknown factor name', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/admin/relevance/weights', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ factorName: 'nonexistent_factor', value: 0.5 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing value', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/admin/relevance/weights', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ factorName: 'recency_boost' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 422 for invalid weight value (fails validation)', async () => {
    const { RelevanceTuner } = await import('@iris/semantic-core/relevance-tuner');
    vi.mocked(RelevanceTuner).mockImplementationOnce(() => ({
      loadWeights: vi.fn().mockResolvedValue({ ...defaultWeights }),
      updateWeight: vi.fn().mockRejectedValue(new Error('recency_boost must be in [0, 1]')),
      recordFeedback: vi.fn(), analyzeFeedback: vi.fn(), resetWeights: vi.fn(),
    }));
    const sql = vi.fn();
    const app = new Hono();
    app.route('/api/v1/admin/relevance', createRelevanceRoutes(sql as never));
    const res = await app.request('/api/v1/admin/relevance/weights', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ factorName: 'recency_boost', value: -5 }),
    });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/admin/relevance/weights', () => {
  it('resets weights to defaults', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/admin/relevance/weights', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reset: boolean; weights: typeof defaultWeights } };
    expect(body.data.reset).toBe(true);
    expect(body.data.weights.embedding_weight).toBe(0.7);
  });
});

describe('POST /api/v1/admin/relevance/feedback', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it('records feedback and returns 200', async () => {
    const res = await app.request('/api/v1/admin/relevance/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'find contacts', clickedEntityId: 'hubspot:contact:1', rank: 2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 for missing query', async () => {
    const res = await app.request('/api/v1/admin/relevance/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ clickedEntityId: 'hubspot:contact:1', rank: 2 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing clickedEntityId', async () => {
    const res = await app.request('/api/v1/admin/relevance/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'contacts', rank: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts optional dwellTimeMs', async () => {
    const res = await app.request('/api/v1/admin/relevance/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'find contacts', clickedEntityId: 'e:1', rank: 0, dwellTimeMs: 4500 }),
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/admin/relevance/metrics', () => {
  it('returns feedback analysis', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/admin/relevance/metrics', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { feedback: unknown[]; windowDays: number } };
    expect(body.data.feedback).toHaveLength(1);
    expect(body.data.windowDays).toBe(30);
  });

  it('respects ?days query param (capped at 90)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/admin/relevance/metrics?days=180', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { windowDays: number } };
    expect(body.data.windowDays).toBe(90);
  });
});
