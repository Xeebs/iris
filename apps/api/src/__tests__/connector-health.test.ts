import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createConnectorHealthRoutes } from '../routes/connector-health.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/connector-health-scorer', () => {
  const mockScorer = {
    scoreConnector: vi.fn(),
    getHealthHistory: vi.fn(),
    executeRecoveryAction: vi.fn(),
    listActiveAlerts: vi.fn(),
    resolveAlert: vi.fn(),
    suggestRecovery: vi.fn(),
  };
  return {
    ConnectorHealthScorer: vi.fn(() => mockScorer),
    _mockScorer: mockScorer,
  };
});

import { _mockScorer as mockScorer } from '@iris/semantic-core/connector-health-scorer';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createConnectorHealthRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/', createConnectorHealthRoutes(sqlMock));
  return app;
}

beforeEach(() => { vi.clearAllMocks(); });

const scoreFixture = {
  connectorId: 'c-1', workspaceId: 'ws-test',
  overallScore: 87, syncSuccessRate: 0.95, entityFreshness: 0.8,
  errorFrequency: 0.9, authValidity: 1, scoredAt: new Date(),
};

describe('GET /:connectorId/health', () => {
  it('returns health score breakdown', async () => {
    mockScorer.scoreConnector.mockResolvedValueOnce(ok(scoreFixture));
    const res = await makeApp().request('/c-1/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { overallScore: number } };
    expect(body.data.overallScore).toBe(87);
  });

  it('returns 500 on DB error', async () => {
    mockScorer.scoreConnector.mockResolvedValueOnce(err(new Error('db error')));
    const res = await makeApp().request('/c-1/health');
    expect(res.status).toBe(500);
  });
});

describe('GET /:connectorId/health-history', () => {
  it('returns time series of scores', async () => {
    mockScorer.getHealthHistory.mockResolvedValueOnce(ok([scoreFixture, { ...scoreFixture, overallScore: 80 }]));
    const res = await makeApp().request('/c-1/health-history');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it('passes days query param', async () => {
    mockScorer.getHealthHistory.mockResolvedValueOnce(ok([]));
    await makeApp().request('/c-1/health-history?days=14');
    expect(mockScorer.getHealthHistory).toHaveBeenCalledWith('c-1', 'ws-test', 14);
  });
});

describe('POST /:connectorId/recovery-action', () => {
  it('executes and returns 201', async () => {
    const action = { actionId: 'a-1', connectorId: 'c-1', workspaceId: 'ws-test', actionType: 'retry', reason: 'manual', executedAt: new Date(), result: 'initiated' };
    mockScorer.executeRecoveryAction.mockResolvedValueOnce(ok(action));
    const res = await makeApp().request('/c-1/recovery-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType: 'retry' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { actionType: string } };
    expect(body.data.actionType).toBe('retry');
  });

  it('returns 400 for invalid actionType', async () => {
    const res = await makeApp().request('/c-1/recovery-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /health-alerts', () => {
  it('returns active alerts', async () => {
    const alert = { alertId: 'a-1', connectorId: 'c-1', workspaceId: 'ws-test', alertType: 'degradation', severity: 'warning', message: 'score dropped', currentScore: 60, baselineScore: 80, createdAt: new Date(), resolvedAt: null };
    mockScorer.listActiveAlerts.mockResolvedValueOnce(ok([alert]));
    const res = await makeApp().request('/health-alerts');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('DELETE /health-alerts/:alertId', () => {
  it('resolves alert and returns ok', async () => {
    mockScorer.resolveAlert.mockResolvedValueOnce(ok(undefined));
    const res = await makeApp().request('/health-alerts/a-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { resolved: boolean } };
    expect(body.data.resolved).toBe(true);
  });
});

describe('GET /:connectorId/recovery-suggestions', () => {
  it('returns recovery recommendations', async () => {
    mockScorer.suggestRecovery.mockResolvedValueOnce(ok([
      { actionType: 're-auth', reason: 'Low auth validity', priority: 100 },
    ]));
    const res = await makeApp().request('/c-1/recovery-suggestions');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ actionType: string }> };
    expect(body.data[0]?.actionType).toBe('re-auth');
  });
});
