import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/benchmarking', () => ({
  BenchmarkingService: vi.fn().mockImplementation(() => mockSvc),
}));

const mockSvc = {
  collectMetrics: vi.fn(),
  getPeerBenchmarks: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  exportMetrics: vi.fn(),
};

import { createWorkspaceBenchmarkingRoutes } from '../routes/workspace-benchmarking.js';
import { createBenchmarkingRoutes } from '../routes/benchmarking.js';

const WORKSPACE = 'ws-bench-test';

function makeApp(): Hono {
  const app = new Hono();
  app.route('/api/v1', createWorkspaceBenchmarkingRoutes({} as Parameters<typeof createWorkspaceBenchmarkingRoutes>[0]));
  return app;
}

describe('GET /api/v1/benchmark-snapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/benchmark-snapshot');
    expect(res.status).toBe(400);
  });

  it('returns 200 with snapshot on success', async () => {
    const { ok } = await import('neverthrow');
    const snapshot = { workspaceHash: 'abc123', cacheHitRate: 0.75, tokenSavingsRatio: 0.45, entityCount: 1200, collectedAt: '2026-06-08T00:00:00Z' };
    mockSvc.collectMetrics.mockResolvedValue(ok(snapshot));
    const app = makeApp();
    const res = await app.request(`/api/v1/benchmark-snapshot?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof snapshot };
    expect(body.data.cacheHitRate).toBe(0.75);
  });

  it('returns 500 on service error', async () => {
    const { err } = await import('neverthrow');
    mockSvc.collectMetrics.mockResolvedValue(err(new Error('DB error')));
    const app = makeApp();
    const res = await app.request(`/api/v1/benchmark-snapshot?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/benchmarks/peer-comparison', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/benchmarks/peer-comparison');
    expect(res.status).toBe(400);
  });

  it('returns 200 with peer comparison data', async () => {
    const { ok } = await import('neverthrow');
    const peers = { peerCount: 42, comparisons: [{ metricType: 'cache_hit_rate', workspaceValue: 0.75, peerMedian: 0.6, percentileRank: 70 }] };
    mockSvc.getPeerBenchmarks.mockResolvedValue(ok(peers));
    const app = makeApp();
    const res = await app.request(`/api/v1/benchmarks/peer-comparison?workspaceId=${WORKSPACE}&industry=software&companySize=smb`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof peers };
    expect(body.data.peerCount).toBe(42);
  });

  it('returns 422 when no snapshot exists', async () => {
    const { err } = await import('neverthrow');
    mockSvc.getPeerBenchmarks.mockResolvedValue(err(new Error('No snapshot found for workspace')));
    const app = makeApp();
    const res = await app.request(`/api/v1/benchmarks/peer-comparison?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/benchmarks/settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/benchmarks/settings');
    expect(res.status).toBe(400);
  });

  it('returns 200 with settings', async () => {
    const { ok } = await import('neverthrow');
    const settings = { workspaceId: WORKSPACE, benchmarkingEnabled: true, industry: 'software', companySize: 'smb' };
    mockSvc.getSettings.mockResolvedValue(ok(settings));
    const app = makeApp();
    const res = await app.request(`/api/v1/benchmarks/settings?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof settings };
    expect(body.data.benchmarkingEnabled).toBe(true);
  });
});

describe('PUT /api/v1/benchmarks/settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 on invalid body', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/benchmarks/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ industry: 'software' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful update', async () => {
    const { ok } = await import('neverthrow');
    const updated = { workspaceId: WORKSPACE, benchmarkingEnabled: true, industry: 'finance', companySize: 'midmarket' as const };
    mockSvc.updateSettings.mockResolvedValue(ok(updated));
    const app = makeApp();
    const res = await app.request('/api/v1/benchmarks/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, industry: 'finance', companySize: 'midmarket' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof updated };
    expect(body.data.industry).toBe('finance');
  });
});

describe('POST /api/v1/benchmarks/export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 on missing fields', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/benchmarks/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful export', async () => {
    const { ok } = await import('neverthrow');
    mockSvc.exportMetrics.mockResolvedValue(ok(true));
    const app = makeApp();
    const res = await app.request('/api/v1/benchmarks/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, industry: 'software', companySize: 'smb' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { exported: boolean } };
    expect(body.data.exported).toBe(true);
  });

  it('returns 422 when no snapshot exists', async () => {
    const { err } = await import('neverthrow');
    mockSvc.exportMetrics.mockResolvedValue(err(new Error('No snapshot found for export')));
    const app = makeApp();
    const res = await app.request('/api/v1/benchmarks/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, industry: 'software', companySize: 'smb' }),
    });
    expect(res.status).toBe(422);
  });
});

// ─── /benchmarks opt-in API (new opt-in/opt-out/peers routes) ─────────────────

function makeBenchApp() {
  const app = new Hono();
  app.route('/benchmarks', createBenchmarkingRoutes({} as Parameters<typeof createBenchmarkingRoutes>[0]));
  return app;
}

describe('GET /benchmarks/opt-in', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without workspace header', async () => {
    const app = makeBenchApp();
    const res = await app.request('/benchmarks/opt-in');
    expect(res.status).toBe(401);
  });

  it('returns settings for workspace', async () => {
    const { ok } = await import('neverthrow');
    mockSvc.getSettings.mockResolvedValue(ok({ workspaceId: WORKSPACE, benchmarkingEnabled: false, industry: null, companySize: null }));
    const app = makeBenchApp();
    const res = await app.request('/benchmarks/opt-in', { headers: { 'x-workspace-id': WORKSPACE } });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { benchmarkingEnabled: boolean } };
    expect(json.data.benchmarkingEnabled).toBe(false);
  });
});

describe('POST /benchmarks/opt-in', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 for invalid companySize', async () => {
    const app = makeBenchApp();
    const res = await app.request('/benchmarks/opt-in', {
      method: 'POST',
      headers: { 'x-workspace-id': WORKSPACE, 'content-type': 'application/json' },
      body: JSON.stringify({ industry: 'software', companySize: 'unicorn' }),
    });
    expect(res.status).toBe(400);
  });

  it('opts in and returns updated settings', async () => {
    const { ok } = await import('neverthrow');
    const updated = { workspaceId: WORKSPACE, benchmarkingEnabled: true, industry: 'software', companySize: 'smb' };
    mockSvc.updateSettings.mockResolvedValue(ok(updated));
    const app = makeBenchApp();
    const res = await app.request('/benchmarks/opt-in', {
      method: 'POST',
      headers: { 'x-workspace-id': WORKSPACE, 'content-type': 'application/json' },
      body: JSON.stringify({ industry: 'software', companySize: 'smb' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: typeof updated };
    expect(json.data.benchmarkingEnabled).toBe(true);
  });
});

describe('POST /benchmarks/opt-out', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opts out and returns confirmation', async () => {
    const { ok } = await import('neverthrow');
    mockSvc.updateSettings.mockResolvedValue(ok({ workspaceId: WORKSPACE, benchmarkingEnabled: false, industry: null, companySize: null }));
    const app = makeBenchApp();
    const res = await app.request('/benchmarks/opt-out', {
      method: 'POST',
      headers: { 'x-workspace-id': WORKSPACE },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { optedOut: boolean } };
    expect(json.data.optedOut).toBe(true);
  });
});

describe('GET /benchmarks/peers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 422 when no snapshot exists', async () => {
    const { err } = await import('neverthrow');
    mockSvc.getPeerBenchmarks.mockResolvedValue(err(new Error('No snapshot found')));
    const app = makeBenchApp();
    const res = await app.request('/benchmarks/peers', { headers: { 'x-workspace-id': WORKSPACE } });
    expect(res.status).toBe(422);
  });

  it('returns peer comparison report', async () => {
    const { ok } = await import('neverthrow');
    const report = {
      workspaceId: WORKSPACE,
      metrics: { entityCount: 100, queryCount: 50, avgContextSizeTokens: 1500, tokenSavingsRatio: 0.6, cacheHitRate: 0.75, snapshotAt: new Date() },
      peerComparisons: [{ metric: 'cacheHitRate', workspaceValue: 0.75, peerPercentiles: { p25: 0.4, p50: 0.6, p75: 0.8, p90: 0.9 }, percentileRank: 65 }],
      peerCount: 20,
    };
    mockSvc.getPeerBenchmarks.mockResolvedValue(ok(report));
    const app = makeBenchApp();
    const res = await app.request('/benchmarks/peers', { headers: { 'x-workspace-id': WORKSPACE } });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: typeof report };
    expect(json.data.peerCount).toBe(20);
  });
});
