import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeSearchQualityRouter } from '../routes/search-quality.js';

vi.mock('@iris/semantic-core/search-quality-evaluator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@iris/semantic-core/search-quality-evaluator')>();
  const ok = (v: unknown) => ({ isOk: () => true, isErr: () => false, value: v });
  const er = (m: string) => ({ isOk: () => false, isErr: () => true, error: new Error(m) });

  const MockService = vi.fn().mockImplementation(() => ({
    defineTestSet: vi.fn().mockResolvedValue(ok({ id: 'ts1', workspaceId: 'ws1', name: 'My Set', queryCount: 2 })),
    createExperiment: vi.fn().mockResolvedValue(ok({ id: 'exp1', workspaceId: 'ws1', name: 'Test Exp', controlStrategy: 'vector', treatmentStrategy: 'hybrid', testSetId: null, trafficPct: 10, status: 'running', winner: null, createdBy: null, createdAt: new Date() })),
    recordResult: vi.fn().mockResolvedValue(ok(undefined)),
    getResults: vi.fn().mockResolvedValue(ok([{ strategyName: 'control', metrics: { precisionAtK: 0.8, recallAtK: 0.7, ndcgAtK: 0.75, mrr: 0.9, sampleSize: 10 } }])),
    promoteExperiment: vi.fn().mockResolvedValue(ok({ id: 'exp1', status: 'promoted', winner: 'hybrid' })),
    listExperiments: vi.fn().mockResolvedValue(ok([])),
    _er: er,
  }));

  return { ...actual, SearchQualityEvaluator: MockService };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp() {
  const app = new Hono();
  app.route('/api/v1/search-quality', makeSearchQualityRouter(makeSql()));
  return app;
}

describe('POST /search-quality/evaluate', () => {
  it('returns computed metrics', async () => {
    const res = await buildApp().request('/api/v1/search-quality/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retrievedIds: ['e1', 'e2', 'e3'], expectedIds: ['e1', 'e3'], k: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { precisionAtK: number; mrr: number } };
    expect(body.data.precisionAtK).toBeGreaterThan(0);
    expect(body.data.mrr).toBeGreaterThan(0);
  });

  it('returns 400 for missing expectedIds', async () => {
    const res = await buildApp().request('/api/v1/search-quality/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retrievedIds: ['e1'] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /search-quality/test-sets', () => {
  it('creates a test set', async () => {
    const res = await buildApp().request('/api/v1/search-quality/test-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ws1',
        name: 'My Set',
        queries: [{ query: 'find contacts', expectedEntityIds: ['e1', 'e2'] }],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { name: string } };
    expect(body.data.name).toBe('My Set');
  });

  it('returns 400 when queries is empty', async () => {
    const res = await buildApp().request('/api/v1/search-quality/test-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws1', name: 'Bad', queries: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /search-quality/experiments', () => {
  it('creates an experiment', async () => {
    const res = await buildApp().request('/api/v1/search-quality/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws1', name: 'Test Exp', controlStrategy: 'vector', treatmentStrategy: 'hybrid' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe('exp1');
  });

  it('returns 400 for invalid strategy', async () => {
    const res = await buildApp().request('/api/v1/search-quality/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws1', name: 'Bad', controlStrategy: 'unknown', treatmentStrategy: 'hybrid' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /search-quality/experiments', () => {
  it('returns experiments for workspace', async () => {
    const res = await buildApp().request('/api/v1/search-quality/experiments?workspaceId=ws1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 400 for missing workspaceId', async () => {
    const res = await buildApp().request('/api/v1/search-quality/experiments');
    expect(res.status).toBe(400);
  });
});

describe('POST /search-quality/experiments/:id/results', () => {
  it('records a result', async () => {
    const res = await buildApp().request('/api/v1/search-quality/experiments/exp1/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategyName: 'control', retrievedIds: ['e1', 'e2'], expectedIds: ['e1'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });
});

describe('GET /search-quality/experiments/:id/results', () => {
  it('returns results with comparison null for single strategy', async () => {
    const res = await buildApp().request('/api/v1/search-quality/experiments/exp1/results');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { results: unknown[]; comparison: null } };
    expect(body.data.results).toHaveLength(1);
    expect(body.data.comparison).toBeNull();
  });
});

describe('POST /search-quality/experiments/:id/promote', () => {
  it('promotes winning strategy', async () => {
    const res = await buildApp().request('/api/v1/search-quality/experiments/exp1/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws1', winner: 'hybrid' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('promoted');
  });

  it('returns 400 for invalid winner', async () => {
    const res = await buildApp().request('/api/v1/search-quality/experiments/exp1/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws1', winner: 'unknown' }),
    });
    expect(res.status).toBe(400);
  });
});
