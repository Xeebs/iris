import { describe, it, expect, vi } from 'vitest';
import { makeAnalyticsRouter } from '../routes/analytics-pipeline.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/analytics-engine', async () => {
  const actual = await vi.importActual('@iris/semantic-core/analytics-engine') as typeof import('@iris/semantic-core/analytics-engine');
  const { ok } = await import('neverthrow');

  class MockAnalyticsService {
    recordMetricEvent = vi.fn().mockResolvedValue(ok({ id: 'e1', name: 'query_latency', value: 100, dimensions: {}, workspaceId: 'ws-1', timestamp: new Date() }));
    aggregateMetrics = vi.fn().mockResolvedValue(ok({ metricName: 'query_latency', window: '1d', dimensions: {}, p50: 50, p95: 95, p99: 99, mean: 55, stddev: 10, count: 100, computedAt: new Date() }));
    detectMetricAnomalies = vi.fn().mockResolvedValue(ok([
      { metricName: 'query_latency', timestamp: new Date(), value: 500, expectedValue: 100, zScore: 3.5, isAnomaly: true },
      { metricName: 'query_latency', timestamp: new Date(), value: 50, expectedValue: 50, zScore: 0.1, isAnomaly: false },
    ]));
    getDashboard = vi.fn().mockResolvedValue(ok({ template: 'token-efficiency', avgTokenSavedPct: 35, aggregates: [] }));
    rollupOldData = vi.fn().mockResolvedValue(ok(250));
  }

  return { ...actual, AnalyticsService: MockAnalyticsService };
});

function makeApp() {
  const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
  return makeAnalyticsRouter(sql);
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('POST /analytics/events', () => {
  it('records a metric event', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/events', {
      method: 'POST',
      body: JSON.stringify({ name: 'query_latency', value: 120 }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('query_latency');
  });

  it('returns 400 for missing name', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/events', {
      method: 'POST',
      body: JSON.stringify({ value: 120 }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when workspace header missing', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'q', value: 1 }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /analytics/metrics/:name', () => {
  it('returns aggregate for a metric', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/metrics/query_latency'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.metricName).toBe('query_latency');
    expect(body.data).toHaveProperty('p50');
    expect(body.data).toHaveProperty('mean');
  });

  it('returns 400 for invalid window', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/metrics/query_latency?window=1m'));
    expect(res.status).toBe(400);
  });
});

describe('GET /analytics/metrics/:name/anomalies', () => {
  it('returns only anomalous results', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/metrics/query_latency/anomalies'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.every((r: { isAnomaly: boolean }) => r.isAnomaly)).toBe(true);
    expect(body.meta.anomalyCount).toBe(1);
    expect(body.meta.total).toBe(2);
  });
});

describe('GET /analytics/dashboards/:templateName', () => {
  it('returns token-efficiency dashboard', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/dashboards/token-efficiency'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.template).toBe('token-efficiency');
    expect(body.data).toHaveProperty('avgTokenSavedPct');
  });

  it('returns 400 for invalid template', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/dashboards/invalid-template'));
    expect(res.status).toBe(400);
  });
});

describe('POST /analytics/rollup', () => {
  it('triggers rollup and returns count', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/rollup', { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rolledUpEvents).toBe(250);
  });
});
