import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/benchmarking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@iris/semantic-core/benchmarking')>();
  return { ...actual, BenchmarkingService: vi.fn() };
});

import { BenchmarkingService } from '@iris/semantic-core/benchmarking';
import { createWorkspaceBenchmarkingRoutes } from '../routes/workspace-benchmarking.js';

const WORKSPACE = 'ws-bench';

const FAKE_METRICS = {
  entityCount: 100,
  queryCount: 200,
  avgContextSizeTokens: 1500,
  tokenSavingsRatio: 0.6,
  cacheHitRate: 0.75,
  snapshotAt: new Date(),
};

const FAKE_REPORT = {
  workspaceId: WORKSPACE,
  metrics: FAKE_METRICS,
  peerComparisons: [
    { metric: 'tokenSavingsRatio', workspaceValue: 0.6, peerPercentiles: { p25: 0.3, p50: 0.5, p75: 0.65, p90: 0.8 }, percentileRank: 75 },
  ],
  peerCount: 42,
};

function makeApp(methods: Partial<InstanceType<typeof BenchmarkingService>>) {
  vi.mocked(BenchmarkingService).mockImplementation(() => methods as InstanceType<typeof BenchmarkingService>);
  const fakeSql = {} as Parameters<typeof createWorkspaceBenchmarkingRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/workspace', createWorkspaceBenchmarkingRoutes(fakeSql));
  return app;
}

describe('GET /api/v1/workspace/benchmark-snapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/benchmark-snapshot');
    expect(res.status).toBe(400);
  });

  it('returns 200 with collected metrics', async () => {
    const collectMetrics = vi.fn().mockResolvedValue(ok(FAKE_METRICS));
    const app = makeApp({ collectMetrics });
    const res = await app.request(`/api/v1/workspace/benchmark-snapshot?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_METRICS };
    expect(body.data.entityCount).toBe(100);
  });

  it('returns 500 on service error', async () => {
    const collectMetrics = vi.fn().mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp({ collectMetrics });
    const res = await app.request(`/api/v1/workspace/benchmark-snapshot?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/workspace/benchmarks/peer-comparison', () => {
  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/benchmarks/peer-comparison');
    expect(res.status).toBe(400);
  });

  it('returns 422 when no snapshot exists', async () => {
    const getPeerBenchmarks = vi.fn().mockResolvedValue(err(new Error('No snapshot found')));
    const app = makeApp({ getPeerBenchmarks });
    const res = await app.request(`/api/v1/workspace/benchmarks/peer-comparison?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(422);
  });

  it('returns 200 with peer comparison report', async () => {
    const getPeerBenchmarks = vi.fn().mockResolvedValue(ok(FAKE_REPORT));
    const app = makeApp({ getPeerBenchmarks });
    const res = await app.request(`/api/v1/workspace/benchmarks/peer-comparison?workspaceId=${WORKSPACE}&industry=saas&companySize=smb`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_REPORT };
    expect(body.data.peerCount).toBe(42);
    expect(body.data.peerComparisons).toHaveLength(1);
  });

  it('ignores invalid companySize query param', async () => {
    const getPeerBenchmarks = vi.fn().mockResolvedValue(ok(FAKE_REPORT));
    const app = makeApp({ getPeerBenchmarks });
    const res = await app.request(`/api/v1/workspace/benchmarks/peer-comparison?workspaceId=${WORKSPACE}&companySize=giant`);
    expect(res.status).toBe(200);
    expect(getPeerBenchmarks).toHaveBeenCalledWith(WORKSPACE, undefined, undefined);
  });
});

describe('GET /api/v1/workspace/benchmarks/settings', () => {
  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/benchmarks/settings');
    expect(res.status).toBe(400);
  });

  it('returns 200 with settings', async () => {
    const getSettings = vi.fn().mockResolvedValue(ok({
      workspaceId: WORKSPACE, benchmarkingEnabled: false, industry: null, companySize: null,
    }));
    const app = makeApp({ getSettings });
    const res = await app.request(`/api/v1/workspace/benchmarks/settings?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { benchmarkingEnabled: boolean } };
    expect(body.data.benchmarkingEnabled).toBe(false);
  });
});

describe('PUT /api/v1/workspace/benchmarks/settings', () => {
  it('returns 400 on invalid body', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/benchmarks/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ benchmarkingEnabled: true }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with updated settings', async () => {
    const updated = { workspaceId: WORKSPACE, benchmarkingEnabled: true, industry: 'saas', companySize: 'smb' as const };
    const updateSettings = vi.fn().mockResolvedValue(ok(updated));
    const app = makeApp({ updateSettings });
    const res = await app.request('/api/v1/workspace/benchmarks/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, benchmarkingEnabled: true, industry: 'saas', companySize: 'smb' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof updated };
    expect(body.data.benchmarkingEnabled).toBe(true);
  });
});

describe('POST /api/v1/workspace/benchmarks/export', () => {
  it('returns 400 on invalid body', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workspace/benchmarks/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful export', async () => {
    const exportMetrics = vi.fn().mockResolvedValue(ok(undefined));
    const app = makeApp({ exportMetrics });
    const res = await app.request('/api/v1/workspace/benchmarks/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, industry: 'saas', companySize: 'smb' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { exported: boolean } };
    expect(body.data.exported).toBe(true);
  });

  it('returns 422 when no snapshot to export', async () => {
    const exportMetrics = vi.fn().mockResolvedValue(err(new Error('No snapshot to export')));
    const app = makeApp({ exportMetrics });
    const res = await app.request('/api/v1/workspace/benchmarks/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, industry: 'saas', companySize: 'smb' }),
    });
    expect(res.status).toBe(422);
  });
});
