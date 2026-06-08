import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/embedding-provider', () => ({
  createDefaultProvider: vi.fn().mockReturnValue({
    getModelId: () => 'test-model',
    getModelDimensions: () => 1536,
    batchEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2]]),
  }),
}));

const mockGenerateReport = vi.fn().mockResolvedValue({
  workspaceId: 'ws-1',
  overallHealthScore: 95,
  driftScore: 0.02,
  consistencyScore: 0.98,
  outlierCount: 1,
  qualityIssuesCount: 0,
  recommendedActions: ['ok'],
  sampleSize: 100,
  checkedAt: new Date(),
});

const mockGetHistory = vi.fn().mockResolvedValue([
  {
    workspaceId: 'ws-1',
    overallHealthScore: 95,
    driftScore: 0.02,
    consistencyScore: 0.98,
    outlierCount: 1,
    qualityIssuesCount: 0,
    recommendedActions: ['ok'],
    sampleSize: 100,
    checkedAt: new Date(),
  },
]);

vi.mock('@iris/semantic-core/vector-health', () => ({
  VectorHealthService: vi.fn().mockImplementation(() => ({
    generateHealthReport: mockGenerateReport,
    getHealthHistory: mockGetHistory,
  })),
}));

import { createVectorHealthRoutes } from '../routes/vector-health.js';

function makeApp(): Hono {
  const fakeSql = {} as Parameters<typeof createVectorHealthRoutes>[0];
  const app = new Hono();
  app.route('/admin/vector-health', createVectorHealthRoutes(fakeSql));
  return app;
}

describe('GET /admin/vector-health', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/admin/vector-health');
    expect(res.status).toBe(400);
  });

  it('returns history for a workspace', async () => {
    const app = makeApp();
    const res = await app.request('/admin/vector-health?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { latest: unknown; history: unknown[] } };
    expect(body.data.history.length).toBe(1);
    expect(body.data.latest).toBeDefined();
  });

  it('returns null latest when no history exists', async () => {
    mockGetHistory.mockResolvedValueOnce([]);
    const app = makeApp();
    const res = await app.request('/admin/vector-health?workspaceId=ws-empty');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { latest: null } };
    expect(body.data.latest).toBeNull();
  });
});

describe('POST /admin/vector-health/run', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 for invalid JSON', async () => {
    const app = makeApp();
    const res = await app.request('/admin/vector-health/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/admin/vector-health/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleSize: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for out-of-range sampleSize', async () => {
    const app = makeApp();
    const res = await app.request('/admin/vector-health/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', sampleSize: 50000 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with health report on success', async () => {
    const app = makeApp();
    const res = await app.request('/admin/vector-health/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { overallHealthScore: number } };
    expect(body.data.overallHealthScore).toBe(95);
  });

  it('returns 200 with custom sampleSize', async () => {
    const app = makeApp();
    const res = await app.request('/admin/vector-health/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', sampleSize: 500 }),
    });
    expect(res.status).toBe(200);
    expect(mockGenerateReport).toHaveBeenCalledWith('ws-1', 500);
  });

  it('returns 500 when health check throws', async () => {
    mockGenerateReport.mockRejectedValueOnce(new Error('DB error'));
    const app = makeApp();
    const res = await app.request('/admin/vector-health/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(500);
  });
});
