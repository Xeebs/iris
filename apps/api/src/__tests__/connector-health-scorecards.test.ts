import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createConnectorHealthScorecardsRoutes } from '../routes/connector-health-scorecards.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/connector-health-scorer', () => {
  const { ok } = require('neverthrow');
  const ConnectorHealthScorer = vi.fn().mockImplementation(() => ({
    scoreConnector: vi.fn().mockResolvedValue(ok({
      connectorId: 'hubspot', workspaceId: 'ws-1',
      overallScore: 87, syncSuccessRate: 0.95, entityFreshness: 0.88,
      errorFrequency: 0.90, authValidity: 1.0, scoredAt: new Date(),
    })),
    getHealthHistory: vi.fn().mockResolvedValue(ok([])),
    listActiveAlerts: vi.fn().mockResolvedValue(ok([])),
    resolveAlert: vi.fn().mockResolvedValue(ok(undefined)),
    executeRecoveryAction: vi.fn().mockResolvedValue(ok({
      actionId: 'act-1', connectorId: 'hubspot', workspaceId: 'ws-1',
      actionType: 'retry', reason: 'Manual retry via health scorer',
      executedAt: new Date(), result: 'initiated',
    })),
    suggestRecovery: vi.fn().mockResolvedValue(ok([])),
  }));
  return { ConnectorHealthScorer };
});

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp(sqlRows: unknown[] = []) {
  const app = new Hono();
  app.route('/health-scorecards', createConnectorHealthScorecardsRoutes(makeSql(sqlRows)));
  return app;
}

// ─── GET /:id/health-score ────────────────────────────────────────────────────

describe('GET /health-scorecards/:id/health-score', () => {
  it('returns 200 with current score', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/hubspot/health-score?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { current: { overallScore: number } } };
    expect(body.data.current.overallScore).toBe(87);
  });

  it('includes history array', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/hubspot/health-score');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { history: unknown[] } };
    expect(Array.isArray(body.data.history)).toBe(true);
  });
});

// ─── POST /:id/sla-config ─────────────────────────────────────────────────────

describe('POST /health-scorecards/:id/sla-config', () => {
  it('returns 201 with created SLA target', async () => {
    const sql = vi.fn().mockResolvedValue([{
      target_id: 'target-1', connector_id: 'hubspot', workspace_id: 'ws-1',
      min_health_score: 80, min_sync_success_rate: 0.95,
      max_sync_latency_seconds: 300, uptime_target_pct: 99.5,
      measurement_window_days: 30, created_at: new Date(),
    }]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;
    const app = new Hono();
    app.route('/health-scorecards', createConnectorHealthScorecardsRoutes(sql));

    const res = await app.request('/health-scorecards/hubspot/sla-config', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', minHealthScore: 80 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { minHealthScore: number } };
    expect(body.data.minHealthScore).toBe(80);
  });

  it('returns 400 for invalid minHealthScore', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/hubspot/sla-config', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', minHealthScore: 150 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /health-summary ─────────────────────────────────────────────────────

describe('GET /health-scorecards/health-summary', () => {
  it('returns 200 with ranked list', async () => {
    const app = buildApp([]);
    const res = await app.request('/health-scorecards/health-summary?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ─── GET /incidents ───────────────────────────────────────────────────────────

describe('GET /health-scorecards/incidents', () => {
  it('returns 200 with alerts array', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/incidents?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ─── POST /incidents/:alertId/resolve ────────────────────────────────────────

describe('POST /health-scorecards/incidents/:alertId/resolve', () => {
  it('returns 200 with resolved=true', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/incidents/alert-1/resolve', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { resolved: boolean } };
    expect(body.data.resolved).toBe(true);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/incidents/alert-1/resolve', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /:id/sla-breaches ───────────────────────────────────────────────────

describe('GET /health-scorecards/:id/sla-breaches', () => {
  it('returns 200 with empty breaches', async () => {
    const app = buildApp([]);
    const res = await app.request('/health-scorecards/hubspot/sla-breaches');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ─── POST /:id/recovery ───────────────────────────────────────────────────────

describe('POST /health-scorecards/:id/recovery', () => {
  it('returns 201 with recovery action', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/hubspot/recovery', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', actionType: 'retry' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { actionType: string } };
    expect(body.data.actionType).toBe('retry');
  });

  it('returns 400 for invalid actionType', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/hubspot/recovery', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', actionType: 'invalid' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /:id/recovery-suggestions ───────────────────────────────────────────

describe('GET /health-scorecards/:id/recovery-suggestions', () => {
  it('returns 200 with suggestions array', async () => {
    const app = buildApp();
    const res = await app.request('/health-scorecards/hubspot/recovery-suggestions');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});
