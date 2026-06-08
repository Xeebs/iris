import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@iris/semantic-core')>();
  return {
    ...actual,
    MetricRegistry: vi.fn(),
  };
});

vi.mock('@iris/semantic-core/metric-formula-engine', () => ({
  MetricFormulaEngine: vi.fn().mockImplementation(() => mockFormulaSvc),
  validateFormula: vi.fn(),
}));

const mockFormulaSvc = {
  evaluate: vi.fn(),
  invalidateCache: vi.fn(),
};

import { MetricRegistry } from '@iris/semantic-core';
import { validateFormula } from '@iris/semantic-core/metric-formula-engine';
import { createMetricRoutes } from '../routes/metrics.js';

const WORKSPACE = 'ws-test';
const FAKE_METRIC = {
  id: 'metric-1',
  workspaceId: WORKSPACE,
  name: 'monthly_revenue',
  formula: 'SUM(amount)',
  description: 'Total monthly revenue',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeApp(mockMethods: Partial<{
  listMetrics: ReturnType<typeof vi.fn>;
  defineMetric: ReturnType<typeof vi.fn>;
  deleteMetric: ReturnType<typeof vi.fn>;
}>): Hono {
  vi.mocked(MetricRegistry).mockImplementation(() => mockMethods as InstanceType<typeof MetricRegistry>);
  const fakeSql = {} as Parameters<typeof createMetricRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/metrics', createMetricRoutes(fakeSql));
  return app;
}

describe('GET /api/v1/metrics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/metrics');
    expect(res.status).toBe(400);
  });

  it('returns 200 with metric list', async () => {
    const { ok } = await import('neverthrow');
    const listMetrics = vi.fn().mockResolvedValue(ok([FAKE_METRIC]));
    const app = makeApp({ listMetrics });
    const res = await app.request(`/api/v1/metrics?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_METRIC[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe('monthly_revenue');
  });

  it('returns 500 when service errors', async () => {
    const { err } = await import('neverthrow');
    const listMetrics = vi.fn().mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp({ listMetrics });
    const res = await app.request(`/api/v1/metrics?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/metrics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'mrr', formula: 'SUM(x)', description: 'desc' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid body', async () => {
    const defineMetric = vi.fn();
    const app = makeApp({ defineMetric });
    const res = await app.request(`/api/v1/metrics?workspaceId=${WORKSPACE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 on success', async () => {
    const { ok } = await import('neverthrow');
    const defineMetric = vi.fn().mockResolvedValue(ok(FAKE_METRIC));
    const app = makeApp({ defineMetric });
    const res = await app.request(`/api/v1/metrics?workspaceId=${WORKSPACE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'monthly_revenue', formula: 'SUM(amount)', description: 'Total monthly revenue' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof FAKE_METRIC };
    expect(body.data.name).toBe('monthly_revenue');
  });
});

describe('DELETE /api/v1/metrics/:name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/metrics/monthly_revenue', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when metric not found', async () => {
    const { ok } = await import('neverthrow');
    const deleteMetric = vi.fn().mockResolvedValue(ok(false));
    const app = makeApp({ deleteMetric });
    const res = await app.request(`/api/v1/metrics/nonexistent?workspaceId=${WORKSPACE}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 200 when deleted', async () => {
    const { ok } = await import('neverthrow');
    const deleteMetric = vi.fn().mockResolvedValue(ok(true));
    const app = makeApp({ deleteMetric });
    const res = await app.request(`/api/v1/metrics/monthly_revenue?workspaceId=${WORKSPACE}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('POST /api/v1/metrics/:id/evaluate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without workspace header', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/metrics/metric-1/evaluate', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 404 when metric not found', async () => {
    const { ok } = await import('neverthrow');
    vi.mocked(MetricRegistry).mockImplementation(() => ({
      getMetric: vi.fn().mockResolvedValue(ok(null)),
    } as unknown as InstanceType<typeof MetricRegistry>));
    const app = new Hono();
    app.route('/api/v1/metrics', createMetricRoutes({} as Parameters<typeof createMetricRoutes>[0]));
    const res = await app.request('/api/v1/metrics/nonexistent/evaluate', {
      method: 'POST',
      headers: { 'x-workspace-id': WORKSPACE },
    });
    expect(res.status).toBe(404);
  });

  it('returns evaluation result on success', async () => {
    const { ok } = await import('neverthrow');
    vi.mocked(MetricRegistry).mockImplementation(() => ({
      getMetric: vi.fn().mockResolvedValue(ok(FAKE_METRIC)),
    } as unknown as InstanceType<typeof MetricRegistry>));
    const evalResult = { metricId: 'metric-1', workspaceId: WORKSPACE, value: 42000, formula: 'SUM(deal.amount)', evaluatedAt: '2026-06-08T00:00:00Z', fromCache: false };
    mockFormulaSvc.evaluate.mockResolvedValue(ok(evalResult));
    const app = new Hono();
    app.route('/api/v1/metrics', createMetricRoutes({} as Parameters<typeof createMetricRoutes>[0]));
    const res = await app.request('/api/v1/metrics/metric-1/evaluate', {
      method: 'POST',
      headers: { 'x-workspace-id': WORKSPACE },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { evaluation: typeof evalResult } };
    expect(body.data.evaluation.value).toBe(42000);
  });

  it('returns 422 on formula error', async () => {
    const { ok, err } = await import('neverthrow');
    vi.mocked(MetricRegistry).mockImplementation(() => ({
      getMetric: vi.fn().mockResolvedValue(ok(FAKE_METRIC)),
    } as unknown as InstanceType<typeof MetricRegistry>));
    mockFormulaSvc.evaluate.mockResolvedValue(err(new Error('Division by entity type')));
    const app = new Hono();
    app.route('/api/v1/metrics', createMetricRoutes({} as Parameters<typeof createMetricRoutes>[0]));
    const res = await app.request('/api/v1/metrics/metric-1/evaluate', {
      method: 'POST',
      headers: { 'x-workspace-id': WORKSPACE },
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/metrics/validate-formula', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when formula is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/metrics/validate-formula', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns valid:true for a correct formula', async () => {
    vi.mocked(validateFormula).mockReturnValue([]);
    const app = makeApp({});
    const res = await app.request('/api/v1/metrics/validate-formula', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formula: 'COUNT(deal)' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { valid: boolean } };
    expect(body.data.valid).toBe(true);
  });

  it('returns valid:false with errors for bad formula', async () => {
    vi.mocked(validateFormula).mockReturnValue([{ message: 'Invalid syntax' }]);
    const app = makeApp({});
    const res = await app.request('/api/v1/metrics/validate-formula', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formula: 'GARBAGE(deal)' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { valid: boolean; errors: { message: string }[] } };
    expect(body.data.valid).toBe(false);
    expect(body.data.errors[0]?.message).toBe('Invalid syntax');
  });
});
