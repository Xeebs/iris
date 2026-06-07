import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/billing-meter', () => ({
  BillingMeter: vi.fn(),
}));
vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { BillingMeter } from '@iris/semantic-core/billing-meter';
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

let mockMeter: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockMeter = {
    calculateCharges: vi.fn().mockResolvedValue(okResult(USAGE_SUMMARY)),
    getWorkspaceTier: vi.fn().mockResolvedValue(okResult(TIER)),
    listPeriods: vi.fn().mockResolvedValue(okResult([PERIOD])),
    recordUsage: vi.fn().mockResolvedValue(okResult(undefined)),
    closePeriod: vi.fn().mockResolvedValue(okResult(PERIOD)),
  };
  vi.mocked(BillingMeter).mockImplementation(() => mockMeter as never);
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
