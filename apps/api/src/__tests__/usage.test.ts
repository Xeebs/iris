import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createUsageRoutes } from '../routes/usage.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/rate-limiter', () => {
  const mockService = {
    getQuotaStatus: vi.fn(),
    setTier: vi.fn(),
    enforceRateLimit: vi.fn(),
    pruneOldBuckets: vi.fn(),
  };
  return {
    RateLimitService: vi.fn(() => mockService),
    TIER_LIMITS: {
      free:       { requestsPerMinute: 30,   requestsPerDay: 1_000,  mcpCallsPerHour: 100 },
      pro:        { requestsPerMinute: 300,  requestsPerDay: 50_000, mcpCallsPerHour: 2_000 },
      enterprise: { requestsPerMinute: 3000, requestsPerDay: 500_000, mcpCallsPerHour: 20_000 },
    },
    _mockService: mockService,
  };
});

import { _mockService as mockService } from '@iris/semantic-core/rate-limiter';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createUsageRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/', createUsageRoutes(sqlMock));
  return app;
}

beforeEach(() => { vi.clearAllMocks(); });

const quotaFixture = {
  workspaceId: 'ws-test', tier: 'free',
  requestsThisMinute: 10, requestsToday: 200, mcpCallsThisHour: 50,
  limits: { requestsPerMinute: 30, requestsPerDay: 1_000, mcpCallsPerHour: 100 },
  rateLimited: false, retryAfterMs: null,
};

describe('GET /usage', () => {
  it('returns quota status', async () => {
    mockService.getQuotaStatus.mockResolvedValueOnce(ok(quotaFixture));
    const res = await makeApp().request('/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof quotaFixture };
    expect(body.data.tier).toBe('free');
    expect(body.data.requestsThisMinute).toBe(10);
  });

  it('returns 500 on error', async () => {
    mockService.getQuotaStatus.mockResolvedValueOnce(err(new Error('db error')));
    const res = await makeApp().request('/usage');
    expect(res.status).toBe(500);
  });
});

describe('GET /limits', () => {
  it('returns tier limit reference table', async () => {
    const res = await makeApp().request('/limits');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, { requestsPerMinute: number }> };
    expect(body.data.free.requestsPerMinute).toBe(30);
    expect(body.data.enterprise.requestsPerMinute).toBe(3000);
  });
});

describe('PUT /limits/tier', () => {
  it('updates tier', async () => {
    mockService.setTier.mockResolvedValueOnce(ok(undefined));
    const res = await makeApp().request('/limits/tier', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'pro' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { tier: string } };
    expect(body.data.tier).toBe('pro');
  });

  it('returns 400 for invalid tier', async () => {
    const res = await makeApp().request('/limits/tier', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'platinum' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /limits/increase-request', () => {
  it('returns 201 submitted', async () => {
    const res = await makeApp().request('/limits/increase-request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Need more for our team' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { submitted: boolean } };
    expect(body.data.submitted).toBe(true);
  });
});
