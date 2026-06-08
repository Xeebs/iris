import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/billing-meter', () => ({
  BillingMeter: vi.fn(),
}));
vi.mock('@iris/semantic-core/connector-cost-attribution', () => ({
  ConnectorCostAttributor: vi.fn(),
}));
vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { BillingMeter } from '@iris/semantic-core/billing-meter';
import { ConnectorCostAttributor } from '@iris/semantic-core/connector-cost-attribution';
import { createBillingRoutes } from '../routes/billing.js';

const TIER = {
  tierName: 'starter',
  monthlyBaseCents: 0,
  entityIndexPriceCents: 0,
  queryPriceCents: 0,
  includedTokens: 500000,
};

const USAGE_SUMMARY = {
  workspaceId: 'ws-1',
  periodStart: new Date('2026-06-01'),
  periodEnd: new Date('2026-06-07'),
  tier: TIER,
  usageCounts: { entity_indexed: 100, query_executed: 50, token_spent: 10000, api_call: 200 },
  baseChargeCents: 0,
  usageChargeCents: 0,
  totalChargeCents: 0,
  forecastedMonthEndCents: 0,
};

const PERIOD = {
  id: 'period-1',
  workspaceId: 'ws-1',
  periodStart: new Date('2026-05-01'),
  periodEnd: new Date('2026-05-31'),
  totalChargesCents: 4900,
  status: 'invoiced',
  createdAt: new Date('2026-06-01'),
};

function okResult<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value, error: null };
}
function errResult(msg: string) {
  const e = new Error(msg);
  return { isOk: () => false, isErr: () => true, value: undefined, error: e };
}

const COST_BREAKDOWN = {
  workspaceId: 'ws-1',
  periodStart: new Date('2026-05-01'),
  periodEnd: new Date('2026-05-31'),
  totalCostCents: 1.5,
  connectors: [
    {
      connectorId: 'conn-hubspot',
      entityCount: 5000,
      indexCostCents: 0.5,
      queryCostCents: 0.5,
      totalCostCents: 1.0,
      tokensSpent: 50000,
      tokensSaved: 10000,
      queryCount: 200,
      roiScore: 200,
    },
    {
      connectorId: 'conn-legacy',
      entityCount: 2000,
      indexCostCents: 0.5,
      queryCostCents: 0,
      totalCostCents: 0.5,
      tokensSpent: 0,
      tokensSaved: 0,
      queryCount: 0,
      roiScore: 0,
    },
  ],
  recommendations: [
    {
      type: 'disable_low_roi',
      connectorId: 'conn-legacy',
      title: 'Disable low-ROI connector: conn-legacy',
      description: 'No queries for 30 days.',
      estimatedSavingsCentsPerMonth: 15,
    },
  ],
};

let mockMeter: Record<string, ReturnType<typeof vi.fn>>;
let mockAttributor: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockMeter = {
    calculateCharges: vi.fn().mockResolvedValue(okResult(USAGE_SUMMARY)),
    getWorkspaceTier: vi.fn().mockResolvedValue(okResult(TIER)),
    listPeriods: vi.fn().mockResolvedValue(okResult([PERIOD])),
    recordUsage: vi.fn().mockResolvedValue(okResult(undefined)),
    closePeriod: vi.fn().mockResolvedValue(okResult(PERIOD)),
  };
  mockAttributor = {
    aggregateByConnector: vi.fn().mockResolvedValue(okResult(COST_BREAKDOWN)),
  };
  vi.mocked(BillingMeter).mockImplementation(() => mockMeter as never);
  vi.mocked(ConnectorCostAttributor).mockImplementation(() => mockAttributor as never);
});

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-1'); await next(); });
  app.route('/billing', createBillingRoutes({} as never));
  return app;
}

describe('GET /billing/usage', () => {
  it('returns current period usage summary', async () => {
    const res = await makeApp().request('/billing/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof USAGE_SUMMARY };
    expect(body.data.workspaceId).toBe('ws-1');
    expect(body.data.tier.tierName).toBe('starter');
  });

  it('returns 401 when workspace missing', async () => {
    const app = new Hono();
    app.route('/billing', createBillingRoutes({} as never));
    const res = await app.request('/billing/usage');
    expect(res.status).toBe(401);
  });

  it('returns 500 on service error', async () => {
    mockMeter.calculateCharges!.mockResolvedValue(errResult('db error'));
    const res = await makeApp().request('/billing/usage');
    expect(res.status).toBe(500);
  });
});

describe('GET /billing/tier', () => {
  it('returns workspace billing tier', async () => {
    const res = await makeApp().request('/billing/tier');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof TIER };
    expect(body.data.tierName).toBe('starter');
  });

  it('returns 500 on service error', async () => {
    mockMeter.getWorkspaceTier!.mockResolvedValue(errResult('db fail'));
    const res = await makeApp().request('/billing/tier');
    expect(res.status).toBe(500);
  });
});

describe('GET /billing/periods', () => {
  it('returns billing period history', async () => {
    const res = await makeApp().request('/billing/periods');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof PERIOD[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.status).toBe('invoiced');
  });
});

describe('POST /billing/events', () => {
  it('records a usage event', async () => {
    const res = await makeApp().request('/billing/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'entity_indexed', quantity: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 when eventType missing', async () => {
    const res = await makeApp().request('/billing/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    mockMeter.recordUsage!.mockResolvedValue(errResult('db fail'));
    const res = await makeApp().request('/billing/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'query_executed' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /billing/connectors', () => {
  it('returns cost breakdown with connectors and recommendations', async () => {
    const res = await makeApp().request('/billing/connectors');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof COST_BREAKDOWN };
    expect(body.data.connectors).toHaveLength(2);
    expect(body.data.totalCostCents).toBe(1.5);
    expect(body.data.recommendations).toHaveLength(1);
    expect(body.data.recommendations[0]!.type).toBe('disable_low_roi');
  });

  it('returns 401 when workspace missing', async () => {
    const app = new Hono();
    app.route('/billing', createBillingRoutes({} as never));
    const res = await app.request('/billing/connectors');
    expect(res.status).toBe(401);
  });

  it('accepts periodStart and periodEnd query params', async () => {
    const res = await makeApp().request(
      '/billing/connectors?periodStart=2026-05-01&periodEnd=2026-05-31',
    );
    expect(res.status).toBe(200);
    expect(mockAttributor.aggregateByConnector).toHaveBeenCalledWith(
      'ws-1',
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('returns 500 on service error', async () => {
    mockAttributor.aggregateByConnector!.mockResolvedValue(errResult('db error'));
    const res = await makeApp().request('/billing/connectors');
    expect(res.status).toBe(500);
  });

  it('returns 400 on invalid date params', async () => {
    const res = await makeApp().request('/billing/connectors?periodStart=not-a-date');
    expect(res.status).toBe(400);
  });
});
