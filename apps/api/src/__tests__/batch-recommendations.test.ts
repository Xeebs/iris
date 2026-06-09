import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeBatchRecommendationsRouter } from '../routes/batch-recommendations.js';

vi.mock('@iris/semantic-core/batch-recommender', () => {
  const ok = (v: unknown) => ({ isOk: () => true, isErr: () => false, value: v });
  const er = (m: string) => ({ isOk: () => false, isErr: () => true, error: new Error(m) });

  const MockService = vi.fn().mockImplementation(() => ({
    recommendContextForEntities: vi.fn().mockResolvedValue(ok({ sessionId: 'sess1', perEntity: [], sharedContexts: [], generatedAt: new Date() })),
    analyzeEntityGroup: vi.fn().mockResolvedValue(ok({ entityIds: ['e1'], commonTypes: ['contact'], characteristics: [], gaps: [], relationshipDensity: 0.5 })),
    suggestGroupActions: vi.fn().mockResolvedValue(ok([{ action: 'bulk_link', affectedEntityIds: ['e1'], reason: 'test', priority: 'high' }])),
    computeGroupScore: vi.fn().mockResolvedValue(ok({ metric: 'completeness', mean: 0.8, variance: 0.1, min: 0.5, max: 1.0, trend: 'up' })),
    getSessionResult: vi.fn().mockResolvedValue(ok({ sessionId: 'sess1', perEntity: [], sharedContexts: [], generatedAt: new Date() })),
    _er: er,
  }));

  return { BatchContextRecommender: MockService };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp() {
  const app = new Hono();
  app.route('/api/v1/batch', makeBatchRecommendationsRouter(makeSql()));
  return app;
}

describe('POST /batch/recommend-contexts', () => {
  it('returns 201 with session info', async () => {
    const res = await buildApp().request('/api/v1/batch/recommend-contexts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: ['e1', 'e2'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { sessionId: string } };
    expect(body.data.sessionId).toBe('sess1');
  });

  it('returns 400 for empty entityIds', async () => {
    const res = await buildApp().request('/api/v1/batch/recommend-contexts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing entityIds', async () => {
    const res = await buildApp().request('/api/v1/batch/recommend-contexts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /batch/analyze', () => {
  it('returns group analysis', async () => {
    const res = await buildApp().request('/api/v1/batch/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: ['e1', 'e2'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { commonTypes: string[] } };
    expect(body.data.commonTypes).toContain('contact');
  });

  it('returns 400 for invalid payload', async () => {
    const res = await buildApp().request('/api/v1/batch/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /batch/group-actions', () => {
  it('returns suggested actions', async () => {
    const res = await buildApp().request('/api/v1/batch/group-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: ['e1'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { action: string }[] };
    expect(body.data[0]?.action).toBe('bulk_link');
  });
});

describe('POST /batch/group-score', () => {
  it('returns score stats', async () => {
    const res = await buildApp().request('/api/v1/batch/group-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: ['e1', 'e2'], metric: 'completeness' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { mean: number; trend: string } };
    expect(body.data.mean).toBeCloseTo(0.8);
    expect(body.data.trend).toBe('up');
  });

  it('returns 400 for missing metric', async () => {
    const res = await buildApp().request('/api/v1/batch/group-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: ['e1'] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /batch/results/:sessionId', () => {
  it('returns session result', async () => {
    const res = await buildApp().request('/api/v1/batch/results/sess1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { sessionId: string } };
    expect(body.data.sessionId).toBe('sess1');
  });

  it('returns 404 for unknown session', async () => {
    const { BatchContextRecommender } = await import('@iris/semantic-core/batch-recommender');
    vi.mocked(BatchContextRecommender).mockImplementationOnce(() => ({
      recommendContextForEntities: vi.fn(),
      analyzeEntityGroup: vi.fn(),
      suggestGroupActions: vi.fn(),
      computeGroupScore: vi.fn(),
      getSessionResult: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('Session missing not found') }),
    }));
    const res = await buildApp().request('/api/v1/batch/results/missing');
    expect(res.status).toBe(404);
  });
});
