import { describe, it, expect, vi } from 'vitest';
import { makeQuotaRouter } from '../routes/quota-management.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/rate-limiter', async () => {
  const actual = await vi.importActual('@iris/semantic-core/rate-limiter') as typeof import('@iris/semantic-core/rate-limiter');
  const { ok } = await import('neverthrow');

  class MockRateLimitService {
    enforceRateLimit = vi.fn().mockResolvedValue(ok({ allowed: true, retryAfterMs: null, remaining: 29 }));
    getQuotaStatus = vi.fn().mockResolvedValue(ok({
      workspaceId: 'ws-1',
      tier: 'free',
      requestsThisMinute: 5,
      requestsToday: 100,
      mcpCallsThisHour: 10,
      limits: actual.TIER_LIMITS['free'],
      rateLimited: false,
      retryAfterMs: null,
    }));
    setTier = vi.fn().mockResolvedValue(ok(undefined));
    pruneOldBuckets = vi.fn().mockResolvedValue(ok(0));
  }

  return { ...actual, RateLimitService: MockRateLimitService };
});

type SqlMock = ReturnType<typeof vi.fn>;

function makeApp(sqlOverride?: SqlMock) {
  const sql = (sqlOverride ?? vi.fn().mockResolvedValue([{ id: 'test-id' }])) as unknown as Parameters<typeof makeQuotaRouter>[0];
  return makeQuotaRouter(sql);
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('GET /usage', () => {
  it('returns quota status for workspace', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/usage'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.workspaceId).toBe('ws-1');
    expect(body.data.tier).toBe('free');
    expect(typeof body.data.requestsThisMinute).toBe('number');
  });

  it('returns 400 when workspace header missing', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/usage'));
    expect(res.status).toBe(400);
  });
});

describe('GET /tiers', () => {
  it('returns all tier definitions', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/tiers'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((t: { name: string }) => t.name === 'free')).toBe(true);
    expect(body.data.some((t: { name: string }) => t.name === 'enterprise')).toBe(true);
  });
});

describe('POST /quota-increase-request', () => {
  it('submits increase request', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/quota-increase-request', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: '00000000-0000-0000-0000-000000000001',
        requestedTier: 'pro',
        justification: 'We need more throughput for our integration pipeline.',
      }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('pending');
    expect(body.data.requestedTier).toBe('pro');
  });

  it('returns 400 for missing justification', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/quota-increase-request', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: '00000000-0000-0000-0000-000000000001', requestedTier: 'pro' }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-uuid workspaceId', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/quota-increase-request', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'bad-id', requestedTier: 'pro', justification: 'test justification here' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/rate-limits', () => {
  it('returns list of workspace configs', async () => {
    const sql = vi.fn().mockResolvedValue([
      { workspace_id: 'ws-1', tier: 'pro', updated_at: new Date() },
    ]);
    const app = makeApp(sql);
    const res = await app.fetch(req('/admin/rate-limits'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].tier).toBe('pro');
    expect(body.data[0]).toHaveProperty('limits');
  });
});

describe('PUT /admin/rate-limits/:workspaceId', () => {
  it('sets workspace tier', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/admin/rate-limits/ws-1', {
      method: 'PUT',
      body: JSON.stringify({ tier: 'enterprise' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.tier).toBe('enterprise');
    expect(body.data).toHaveProperty('limits');
  });

  it('returns 400 for invalid tier', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/admin/rate-limits/ws-1', {
      method: 'PUT',
      body: JSON.stringify({ tier: 'ultra' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/quota-overrides', () => {
  it('creates quota override', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/admin/quota-overrides', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: '00000000-0000-0000-0000-000000000001',
        endpoint: 'mcp',
        overrideLimit: 5000,
        reason: 'Peak season traffic',
        grantedBy: 'admin@example.com',
        expiresAt: '2026-12-31T23:59:59Z',
      }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.overrideLimit).toBe(5000);
  });

  it('returns 400 for invalid body', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/admin/quota-overrides', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'mcp' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/quota-increase-requests', () => {
  it('returns pending requests', async () => {
    const sql = vi.fn().mockResolvedValue([
      { id: 'r1', workspace_id: 'ws-1', requested_tier: 'pro', justification: 'need more', status: 'pending', created_at: new Date() },
    ]);
    const app = makeApp(sql);
    const res = await app.fetch(req('/admin/quota-increase-requests'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].requestedTier).toBe('pro');
    expect(body.data[0].status).toBe('pending');
  });
});
