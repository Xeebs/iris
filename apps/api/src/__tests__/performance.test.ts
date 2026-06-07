import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/performance-profiler', () => ({
  PerformanceProfiler: vi.fn(),
}));
vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { PerformanceProfiler } from '@iris/semantic-core/performance-profiler';
import { createPerformanceRoutes } from '../routes/performance.js';

const SAMPLE_STATS = [
  {
    operation: 'vector_search',
    connectorId: null,
    workspaceId: 'ws-1',
    percentiles: { p50: 40, p95: 120, p99: 280, min: 10, max: 350, count: 200 },
    windowStart: new Date(),
  },
];

function okResult<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value, error: null };
}
function errResult(msg: string) {
  const e = new Error(msg);
  return { isOk: () => false, isErr: () => true, value: undefined, error: e };
}

let mockProfiler: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockProfiler = {
    getStats: vi.fn().mockResolvedValue(okResult(SAMPLE_STATS)),
    getConnectorBreakdown: vi.fn().mockResolvedValue(okResult([{ connectorId: 'conn-1', p95Ms: 250, sampleCount: 50 }])),
    formatPrometheus: vi.fn().mockResolvedValue(okResult('# HELP iris_operation_duration_ms gauge\n')),
    record: vi.fn().mockResolvedValue(okResult(undefined)),
  };
  vi.mocked(PerformanceProfiler).mockImplementation(() => mockProfiler as never);
});

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-1'); await next(); });
  app.route('/performance', createPerformanceRoutes({} as never));
  return app;
}

describe('GET /performance/stats', () => {
  it('returns latency stats', async () => {
    const res = await makeApp().request('/performance/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof SAMPLE_STATS };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]!.operation).toBe('vector_search');
  });

  it('passes window query param to service', async () => {
    await makeApp().request('/performance/stats?window=15');
    expect(mockProfiler.getStats).toHaveBeenCalledWith('ws-1', 15);
  });

  it('returns 500 on service error', async () => {
    mockProfiler.getStats!.mockResolvedValue(errResult('db fail'));
    const res = await makeApp().request('/performance/stats');
    expect(res.status).toBe(500);
  });
});

describe('GET /performance/connectors', () => {
  it('returns per-connector breakdown', async () => {
    const res = await makeApp().request('/performance/connectors');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { connectorId: string; p95Ms: number }[] };
    expect(body.data[0]!.connectorId).toBe('conn-1');
  });

  it('returns 401 when workspace missing', async () => {
    const app = new Hono();
    app.route('/performance', createPerformanceRoutes({} as never));
    const res = await app.request('/performance/connectors');
    expect(res.status).toBe(401);
  });

  it('returns 500 on service error', async () => {
    mockProfiler.getConnectorBreakdown!.mockResolvedValue(errResult('db fail'));
    const res = await makeApp().request('/performance/connectors');
    expect(res.status).toBe(500);
  });
});

describe('GET /performance/metrics', () => {
  it('returns prometheus text format', async () => {
    const res = await makeApp().request('/performance/metrics');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('# HELP iris_operation_duration_ms');
  });

  it('returns 500 on prometheus format failure', async () => {
    mockProfiler.formatPrometheus!.mockResolvedValue(errResult('fail'));
    const res = await makeApp().request('/performance/metrics');
    expect(res.status).toBe(500);
  });
});

describe('POST /performance/record', () => {
  it('records a sample and returns ok', async () => {
    const res = await makeApp().request('/performance/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'vector_search', durationMs: 120, success: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 when operation missing', async () => {
    const res = await makeApp().request('/performance/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMs: 100 }),
    });
    expect(res.status).toBe(400);
  });
});
