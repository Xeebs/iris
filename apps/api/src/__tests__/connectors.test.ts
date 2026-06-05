import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// vi.mock is hoisted — factory cannot reference outer variables
vi.mock('@iris/connector-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@iris/connector-sdk')>();
  return {
    ...actual,
    registry: {
      list: vi.fn(),
      get: vi.fn(),
      validateConfig: vi.fn(),
    },
  };
});

import { registry } from '@iris/connector-sdk';
import { connectorRoutes } from '../routes/connectors.js';

// ─── Test app ─────────────────────────────────────────────────────────────────

function makeApp(): Hono {
  const app = new Hono();
  app.route('/api/v1/connectors', connectorRoutes);
  return app;
}

const MANIFEST = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM connector',
  icon: 'hubspot.svg',
  auth: { type: 'oauth2' as const, scopes: ['contacts'] },
  entityTypes: ['contact'],
  configSchema: {} as unknown,
  rateLimits: { requestsPerSecond: 10 },
};

describe('GET /api/v1/connectors', () => {
  beforeEach(() => vi.mocked(registry.list).mockReturnValue([MANIFEST as never]));
  afterEach(() => vi.clearAllMocks());

  it('returns 200 with connector list', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/connectors');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof MANIFEST[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe('hubspot');
  });
});

describe('GET /api/v1/connectors/:id', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 200 with the manifest when found', async () => {
    vi.mocked(registry.get).mockReturnValue(MANIFEST as never);
    const app = makeApp();
    const res = await app.request('/api/v1/connectors/hubspot');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof MANIFEST };
    expect(body.data.id).toBe('hubspot');
  });

  it('returns 404 when connector not found', async () => {
    vi.mocked(registry.get).mockReturnValue(undefined as never);
    const app = makeApp();
    const res = await app.request('/api/v1/connectors/unknown');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/connectors', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 400 on invalid request body', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when connectorId is not registered', async () => {
    vi.mocked(registry.get).mockReturnValue(undefined as never);
    const app = makeApp();
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: 'nonexistent', config: {} }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when config validation fails', async () => {
    vi.mocked(registry.get).mockReturnValue(MANIFEST as never);
    const { err } = await import('neverthrow');
    const { ConnectorError } = await import('@iris/connector-sdk');
    vi.mocked(registry.validateConfig).mockReturnValue(
      err(new ConnectorError('portalId is required', false)) as never,
    );
    const app = makeApp();
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: 'hubspot', config: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain('portalId');
  });

  it('returns 201 when config is valid', async () => {
    vi.mocked(registry.get).mockReturnValue(MANIFEST as never);
    const { ok } = await import('neverthrow');
    vi.mocked(registry.validateConfig).mockReturnValue(ok(undefined) as never);
    const app = makeApp();
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: 'hubspot', config: { portalId: '123' } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('created');
  });
});

describe('POST /api/v1/connectors/:id/test', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 200 with healthy:true when manifest found', async () => {
    vi.mocked(registry.get).mockReturnValue(MANIFEST as never);
    const app = makeApp();
    const res = await app.request('/api/v1/connectors/hubspot/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { healthy: boolean } };
    expect(body.data.healthy).toBe(true);
  });

  it('returns 404 when connector not found', async () => {
    vi.mocked(registry.get).mockReturnValue(undefined as never);
    const app = makeApp();
    const res = await app.request('/api/v1/connectors/unknown/test', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
