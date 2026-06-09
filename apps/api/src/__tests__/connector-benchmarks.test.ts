import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createConnectorBenchmarksRoutes } from '../routes/connector-benchmarks.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/connector-benchmarker', () => {
  const ConnectorBenchmarker = vi.fn().mockImplementation(() => ({
    executeBenchmark: vi.fn().mockResolvedValue({
      connectorId: 'hubspot',
      entityType: 'contact',
      dataSize: 1000,
      durationMs: 500,
      throughputPerSec: 2000,
      memoryPeakMb: 50,
      apiCallCount: 10,
      errorRate: 0,
      avgTransformMs: 0.5,
      runAt: new Date('2026-06-01T00:00:00Z'),
    }),
    compareConnectors: vi.fn().mockReturnValue({
      entityType: 'contact',
      connectorIds: ['hubspot', 'salesforce'],
      rankings: { fastest: 'hubspot', lowestMemory: 'salesforce', mostReliable: 'salesforce' },
      results: [],
    }),
    detectPerformanceRegression: vi.fn().mockReturnValue({
      connectorId: 'hubspot',
      entityType: 'contact',
      hasRegression: false,
      throughputDeltaPct: 2.5,
      memoryDeltaPct: 1.0,
      details: 'Performance within normal bounds',
    }),
    getResults: vi.fn().mockResolvedValue([
      {
        connectorId: 'hubspot',
        entityType: 'contact',
        dataSize: 1000,
        durationMs: 500,
        throughputPerSec: 2000,
        memoryPeakMb: 50,
        apiCallCount: 10,
        errorRate: 0,
        avgTransformMs: 0.5,
        runAt: new Date('2026-06-01T00:00:00Z'),
      },
    ]),
    getBenchmarkMatrix: vi.fn().mockResolvedValue({
      contact: { hubspot: null, salesforce: null },
      deal: { hubspot: null, salesforce: null },
    }),
  }));
  return { ConnectorBenchmarker };
});

function makeSql() {
  const fn = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp() {
  const app = new Hono();
  const sql = makeSql();
  app.route('/connector-benchmarks', createConnectorBenchmarksRoutes(sql));
  return app;
}

// ─── POST /:id/benchmark ──────────────────────────────────────────────────────

describe('POST /connector-benchmarks/:id/benchmark', () => {
  it('returns 200 with benchmark metrics', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/hubspot/benchmark', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'contact', dataSize: 1000 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { connectorId: string } };
    expect(body.data.connectorId).toBe('hubspot');
  });

  it('returns 400 for missing entityType', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/hubspot/benchmark', {
      method: 'POST',
      body: JSON.stringify({ dataSize: 1000 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid dataSize', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/hubspot/benchmark', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'contact', dataSize: 999 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /:id/benchmark-results ───────────────────────────────────────────────

describe('GET /connector-benchmarks/:id/benchmark-results', () => {
  it('returns 200 with results array', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/hubspot/benchmark-results');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('accepts entityType query param', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/hubspot/benchmark-results?entityType=contact');
    expect(res.status).toBe(200);
  });

  it('accepts limit query param', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/hubspot/benchmark-results?limit=10');
    expect(res.status).toBe(200);
  });
});

// ─── POST /compare ────────────────────────────────────────────────────────────

describe('POST /connector-benchmarks/compare', () => {
  it('returns 200 with comparison data', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/compare', {
      method: 'POST',
      body: JSON.stringify({
        connectorIds: ['hubspot', 'salesforce'],
        entityType: 'contact',
        dataSize: 1000,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { rankings: Record<string, string> } };
    expect(body.data.rankings.fastest).toBe('hubspot');
  });

  it('returns 400 for empty connectorIds', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/compare', {
      method: 'POST',
      body: JSON.stringify({ connectorIds: [], entityType: 'contact', dataSize: 1000 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── POST /benchmark-matrix ───────────────────────────────────────────────────

describe('POST /connector-benchmarks/benchmark-matrix', () => {
  it('returns 200 with matrix data', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/benchmark-matrix', {
      method: 'POST',
      body: JSON.stringify({
        connectorIds: ['hubspot', 'salesforce'],
        entityTypes: ['contact', 'deal'],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toHaveProperty('contact');
  });

  it('returns 400 for missing connectorIds', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/benchmark-matrix', {
      method: 'POST',
      body: JSON.stringify({ entityTypes: ['contact'] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /:id/regression ──────────────────────────────────────────────────────

describe('GET /connector-benchmarks/:id/regression', () => {
  it('returns 200 with regression payload', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/hubspot/regression?entityType=contact');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { connectorId: string } };
    expect(body.data.connectorId).toBe('hubspot');
  });

  it('returns 200 using default entityType when omitted', async () => {
    const app = buildApp();
    const res = await app.request('/connector-benchmarks/hubspot/regression');
    expect(res.status).toBe(200);
  });
});
