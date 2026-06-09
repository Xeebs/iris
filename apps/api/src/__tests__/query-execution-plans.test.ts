import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  };
});

type PlanRow = {
  plan_id: string;
  workspace_id: string;
  query: string;
  strategy: string;
  connectors: string[];
  estimated_latency_ms: number;
  estimated_token_cost: number;
  strategy_rankings: unknown;
  created_at: string;
};

function makePlanRow(id = 'plan-1'): PlanRow {
  return {
    plan_id: id,
    workspace_id: 'ws-1',
    query: 'find all contacts',
    strategy: 'parallel',
    connectors: ['hubspot', 'salesforce'],
    estimated_latency_ms: 350,
    estimated_token_cost: 1200,
    strategy_rankings: [{ strategy: 'parallel', overallScore: 0.82, pros: ['fast'], cons: [] }],
    created_at: new Date().toISOString(),
  };
}

function makeSql(rowsByQuery: Record<string, unknown[]> = {}) {
  const fn = vi.fn((strings: TemplateStringsArray) => {
    const q = Array.from(strings.raw).join('');
    for (const [key, rows] of Object.entries(rowsByQuery)) {
      if (q.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([makePlanRow()]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (arr: unknown) => arr;
  (fn as Record<string, unknown>).json = (obj: unknown) => obj;
  return fn;
}

async function buildApp(sql: ReturnType<typeof makeSql>) {
  const { createQueryExecutionPlansRoutes } = await import('../routes/query-execution-plans.js');
  const app = new Hono();
  app.route('/', createQueryExecutionPlansRoutes(sql));
  return app;
}

// ─── GET /plans ───────────────────────────────────────────────────────────────

describe('GET /query-execution-plans/plans', () => {
  it('returns 200 with data array', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/plans', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns meta with hasMore and nextCursor', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/plans', { headers: { 'x-workspace-id': 'ws-1' } });
    const body = (await res.json()) as { meta: { hasMore: boolean; nextCursor: string | null } };
    expect(body.meta).toHaveProperty('hasMore');
    expect(body.meta).toHaveProperty('nextCursor');
  });

  it('maps snake_case to camelCase', async () => {
    const app = await buildApp(makeSql({ 'query_execution_plans': [makePlanRow('plan-abc')] }));
    const res = await app.request('/plans', { headers: { 'x-workspace-id': 'ws-1' } });
    const body = (await res.json()) as { data: Array<{ planId: string; estimatedLatencyMs: number }> };
    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty('planId');
      expect(body.data[0]).toHaveProperty('estimatedLatencyMs');
    }
  });

  it('filters by strategy query param', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/plans?strategy=parallel', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
  });

  it('supports cursor-based pagination', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/plans?cursor=plan-0', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
  });
});

// ─── GET /plans/:id ────────────────────────────────────────────────────────────

describe('GET /query-execution-plans/plans/:id', () => {
  it('returns 200 with full plan and execution results', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([makePlanRow()])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/plans/plan-1', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { planId: string; executionResults: unknown[] } };
    expect(body.data).toHaveProperty('planId');
    expect(body.data).toHaveProperty('executionResults');
  });

  it('returns 404 when plan not found', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/plans/nonexistent', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(404);
  });
});

// ─── POST /plans/:id/rerun ─────────────────────────────────────────────────────

describe('POST /query-execution-plans/plans/:id/rerun', () => {
  it('returns 200 with dryRun=true', async () => {
    const sql = vi.fn().mockResolvedValue([makePlanRow()]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/plans/plan-1/rerun', {
      method: 'POST',
      body: JSON.stringify({ strategy: 'sequential', dryRun: true }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { dryRun: boolean; selectedStrategy: string } };
    expect(body.data.dryRun).toBe(true);
    expect(body.data.selectedStrategy).toBe('sequential');
  });

  it('returns 201 on actual rerun', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([makePlanRow()])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/plans/plan-1/rerun', {
      method: 'POST',
      body: JSON.stringify({ strategy: 'cached-first', dryRun: false }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { resultId: string; strategy: string } };
    expect(body.data).toHaveProperty('resultId');
    expect(body.data.strategy).toBe('cached-first');
  });

  it('returns 400 for invalid strategy', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/plans/plan-1/rerun', {
      method: 'POST',
      body: JSON.stringify({ strategy: 'invalid-strategy', dryRun: false }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when plan does not exist', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/plans/nonexistent/rerun', {
      method: 'POST',
      body: JSON.stringify({ strategy: 'parallel', dryRun: true }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });

  it('includes originalStrategy in dryRun response', async () => {
    const sql = vi.fn().mockResolvedValue([makePlanRow()]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/plans/plan-1/rerun', {
      method: 'POST',
      body: JSON.stringify({ strategy: 'filtered-first', dryRun: true }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    const body = (await res.json()) as { data: { originalStrategy: string } };
    expect(body.data).toHaveProperty('originalStrategy');
  });
});
