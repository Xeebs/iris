import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createBudgetManagementRoutes } from '../routes/budget-management.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const mockUtilization = {
  workspaceId: 'ws1',
  monthlyBudget: 1_000_000,
  tokensUsed: 750_000,
  utilizationPct: 75,
  remainingTokens: 250_000,
  timeWindowDays: 30,
};

const mockAdjustment = {
  workspaceId: 'ws1',
  currentBudget: 1_000_000,
  recommendedBudget: 720_000,
  basis: '7-day average + 20% headroom',
  avgDailyTokens: 20_000,
};

vi.mock('@iris/semantic-core/budget-monitor', () => ({
  BudgetMonitor: vi.fn().mockImplementation(() => ({
    computeBudgetUtilization: vi.fn().mockResolvedValue({
      isOk: () => true, isErr: () => false, value: mockUtilization,
    }),
    getActiveAlerts: vi.fn().mockResolvedValue({
      isOk: () => true, isErr: () => false, value: [],
    }),
    detectBudgetAnomalies: vi.fn().mockResolvedValue({
      isOk: () => true, isErr: () => false, value: [],
    }),
    suggestBudgetAdjustments: vi.fn().mockResolvedValue({
      isOk: () => true, isErr: () => false, value: mockAdjustment,
    }),
  })),
}));

function makeApp() {
  const sql = vi.fn().mockResolvedValue([]);
  const app = new Hono();
  app.route('/api/v1/workspace', createBudgetManagementRoutes(sql as never));
  return { app, sql };
}

describe('GET /api/v1/workspace/budget-status', () => {
  let app: Hono;
  let sql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ app, sql } = makeApp());
  });

  it('returns utilization and alerts', async () => {
    const res = await app.request('/api/v1/workspace/budget-status', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { utilization: typeof mockUtilization; activeAlerts: unknown[]; anomalies: unknown[] } };
    expect(body.data.utilization.utilizationPct).toBe(75);
    expect(Array.isArray(body.data.activeAlerts)).toBe(true);
    expect(Array.isArray(body.data.anomalies)).toBe(true);
  });

  it('returns 500 when utilization fetch fails', async () => {
    const { BudgetMonitor } = await import('@iris/semantic-core/budget-monitor');
    vi.mocked(BudgetMonitor).mockImplementationOnce(() => ({
      computeBudgetUtilization: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('db error') }),
      getActiveAlerts: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: [] }),
      detectBudgetAnomalies: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: [] }),
      suggestBudgetAdjustments: vi.fn(),
    }));

    const sql2 = vi.fn().mockResolvedValue([]);
    const app2 = new Hono();
    app2.route('/api/v1/workspace', createBudgetManagementRoutes(sql2 as never));

    const res = await app2.request('/api/v1/workspace/budget-status', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/v1/workspace/budget-config', () => {
  let app: Hono;
  let sql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ app, sql } = makeApp());
  });

  it('returns 200 with updated config', async () => {
    const res = await app.request('/api/v1/workspace/budget-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ monthlyTokenBudget: 2_000_000, alertThresholds: [75, 90, 100] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { monthlyTokenBudget: number } };
    expect(body.data.monthlyTokenBudget).toBe(2_000_000);
    expect(sql).toHaveBeenCalled();
  });

  it('returns 400 for missing monthlyTokenBudget', async () => {
    const res = await app.request('/api/v1/workspace/budget-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ rollingWindowDays: 30 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for non-positive budget value', async () => {
    const res = await app.request('/api/v1/workspace/budget-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ monthlyTokenBudget: -100 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing body', async () => {
    const res = await app.request('/api/v1/workspace/budget-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when DB insert fails', async () => {
    sql.mockRejectedValue(new Error('db error'));
    const res = await app.request('/api/v1/workspace/budget-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ monthlyTokenBudget: 1_000_000 }),
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UPDATE_FAILED');
  });
});

describe('GET /api/v1/workspace/budget-history', () => {
  let app: Hono;
  let sql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ app, sql } = makeApp());
  });

  it('returns chart data and suggestion', async () => {
    sql.mockResolvedValue([
      { day: '2026-01-15T00:00:00Z', total_tokens: 20000, query_count: 40, avg_context_size: 500 },
    ]);

    const res = await app.request('/api/v1/workspace/budget-history?days=7', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { chartData: unknown[]; suggestion: typeof mockAdjustment | null } };
    expect(Array.isArray(body.data.chartData)).toBe(true);
    expect(body.data.suggestion).not.toBeNull();
  });

  it('clamps days to max 90', async () => {
    sql.mockResolvedValue([]);
    const res = await app.request('/api/v1/workspace/budget-history?days=180', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 500 when DB query fails', async () => {
    sql.mockRejectedValue(new Error('query failed'));
    const res = await app.request('/api/v1/workspace/budget-history', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('FETCH_FAILED');
  });
});
