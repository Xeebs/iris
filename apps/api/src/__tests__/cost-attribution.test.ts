import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeCostAttributionRouter } from '../routes/cost-attribution.js';

vi.mock('@iris/semantic-core/cost-attribution', () => {
  const ok = (v: unknown) => ({ isOk: () => true, isErr: () => false, value: v });

  const MockService = vi.fn().mockImplementation(() => ({
    attributeCostToEntity: vi.fn().mockResolvedValue(ok(undefined)),
    getEntityCostBreakdown: vi.fn().mockResolvedValue(ok({ entityId: 'e1', totalTokens: 5000, totalComputeMs: 200, queryCount: 3, estimatedCostUsd: 0.0001 })),
    computeConnectorCost: vi.fn().mockResolvedValue(ok({ connectorId: 'hubspot', period: 'month', apiCallCount: 50, tokensIndexed: 20000, tokensRetrieved: 5000, estimatedCostUsd: 0.0005 })),
    aggregateUserCosts: vi.fn().mockResolvedValue(ok({ userId: 'u1', period: 'month', queryCount: 10, totalTokens: 30000, estimatedCostUsd: 0.0006, byConnector: [] })),
    computeCostForecast: vi.fn().mockResolvedValue(ok({ entityId: 'e1', interval: 'week', forecastedTokens: 14000, forecastedCostUsd: 0.00028, confidenceLevel: 'high', basedOnDays: 20 })),
    recordConnectorEvent: vi.fn().mockResolvedValue(ok(undefined)),
  }));

  return { CostAttributor: MockService };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp() {
  const app = new Hono();
  app.route('/api/v1/cost-attribution', makeCostAttributionRouter(makeSql()));
  return app;
}

describe('POST /cost-attribution/attribute', () => {
  it('attributes cost to entity', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/attribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryId: 'q1', entityId: 'e1', tokensUsed: 500, computeMs: 100 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { attributed: boolean } };
    expect(body.data.attributed).toBe(true);
  });

  it('returns 400 for missing fields', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/attribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryId: 'q1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /cost-attribution/entities/:entityId', () => {
  it('returns entity cost breakdown', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/entities/e1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { totalTokens: number } };
    expect(body.data.totalTokens).toBe(5000);
  });
});

describe('GET /cost-attribution/entities/:entityId/forecast', () => {
  it('returns cost forecast', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/entities/e1/forecast?interval=week');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { confidenceLevel: string } };
    expect(body.data.confidenceLevel).toBe('high');
  });

  it('returns 400 for invalid interval', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/entities/e1/forecast?interval=year');
    expect(res.status).toBe(400);
  });
});

describe('GET /cost-attribution/connectors/:connectorId', () => {
  it('returns connector cost summary', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/connectors/hubspot?period=month');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { apiCallCount: number } };
    expect(body.data.apiCallCount).toBe(50);
  });

  it('returns 400 for invalid period', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/connectors/hubspot?period=quarter');
    expect(res.status).toBe(400);
  });
});

describe('GET /cost-attribution/users/:userId', () => {
  it('returns user cost ledger', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/users/u1?period=month');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { queryCount: number } };
    expect(body.data.queryCount).toBe(10);
  });
});

describe('POST /cost-attribution/connector-events', () => {
  it('records connector event', async () => {
    const res = await buildApp().request('/api/v1/cost-attribution/connector-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: 'hubspot', apiCallCount: 100, tokensIndexed: 5000, tokensRetrieved: 1000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });
});
