import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createComputedMetricsRoutes } from '../routes/computed-metrics.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp(sqlRows: unknown[] = []) {
  const app = new Hono();
  app.route('/metrics/computed', createComputedMetricsRoutes(makeSql(sqlRows)));
  return app;
}

// ─── POST /metrics/computed ───────────────────────────────────────────────────

describe('POST /metrics/computed', () => {
  it('creates a metric with valid formula', async () => {
    const app = buildApp([]);
    const res = await app.request('/metrics/computed', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', name: 'ARR', formula: 'sum(subscription.mrr) * 12', description: 'Annual revenue' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { metricId: string; name: string } };
    expect(body.data.name).toBe('ARR');
    expect(body.data.metricId).toContain('arr');
  });

  it('returns 400 for invalid formula syntax', async () => {
    const app = buildApp([]);
    const res = await app.request('/metrics/computed', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', name: 'Bad', formula: 'sum(a.b @@@', description: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PARSE_ERROR');
  });

  it('returns 400 for missing name', async () => {
    const app = buildApp([]);
    const res = await app.request('/metrics/computed', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', formula: 'sum(deal.value)' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /metrics/computed ────────────────────────────────────────────────────

describe('GET /metrics/computed', () => {
  it('returns empty list when no metrics', async () => {
    const app = buildApp([]);
    const res = await app.request('/metrics/computed?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });

  it('returns formatted metrics list', async () => {
    const row = {
      metric_id: 'ws-1:arr', workspace_id: 'ws-1', name: 'ARR',
      formula_text: 'sum(subscription.mrr) * 12', description: 'Annual revenue',
      last_computed_value: '72000', last_computed_at: new Date(),
      computation_status: 'success', computation_error: null,
      created_at: new Date(), updated_at: new Date(),
    };
    const app = buildApp([row]);
    const res = await app.request('/metrics/computed?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ lastComputedValue: number }> };
    expect(body.data[0]!.lastComputedValue).toBe(72000);
  });
});

// ─── GET /metrics/computed/:id/value ─────────────────────────────────────────

describe('GET /metrics/computed/:id/value', () => {
  it('returns 404 for unknown metric', async () => {
    const app = buildApp([]);
    const res = await app.request('/metrics/computed/non-existent/value?workspaceId=ws-1');
    expect(res.status).toBe(404);
  });

  it('returns current computed value', async () => {
    const row = {
      metric_id: 'ws-1:arr', name: 'ARR', formula_text: 'sum(sub.mrr)*12', formula_ast: {},
      last_computed_value: '48000', last_computed_at: new Date(), computation_status: 'success',
    };
    const app = buildApp([row]);
    const res = await app.request('/metrics/computed/ws-1:arr/value?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { value: number; status: string } };
    expect(body.data.value).toBe(48000);
    expect(body.data.status).toBe('success');
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = buildApp([]);
    const res = await app.request('/metrics/computed/m-1/value');
    expect(res.status).toBe(400);
  });
});

// ─── GET /metrics/computed/:id/explain ───────────────────────────────────────

describe('GET /metrics/computed/:id/explain', () => {
  it('returns 200 with empty computation log', async () => {
    const app = buildApp([]);
    const res = await app.request('/metrics/computed/ws-1:arr/explain');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recentComputations: unknown[] } };
    expect(Array.isArray(body.data.recentComputations)).toBe(true);
  });

  it('returns recent computation history', async () => {
    const logRow = {
      log_id: 'l-1', metric_id: 'ws-1:arr',
      computed_value: '72000', entity_count_used: 150, execution_time_ms: '12.5',
      error_message: null, computed_at: new Date(),
    };
    const app = buildApp([logRow]);
    const res = await app.request('/metrics/computed/ws-1:arr/explain');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recentComputations: Array<{ value: number }> } };
    expect(body.data.recentComputations[0]!.value).toBe(72000);
  });
});
