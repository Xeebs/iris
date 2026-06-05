import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

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

vi.mock('../services/connector-service.js', () => ({
  ConnectorService: vi.fn(),
}));

import { registry } from '@iris/connector-sdk';
import { ConnectorService } from '../services/connector-service.js';
import { createConnectorRoutes } from '../routes/connectors.js';

const WORKSPACE = 'ws-test';
const INSTANCE_ID = 'inst-uuid-001';

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

const FAKE_INSTANCE = {
  id: INSTANCE_ID,
  workspaceId: WORKSPACE,
  connectorId: 'hubspot',
  config: { portalId: '123' },
  status: 'active' as const,
  lastSyncedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

function makeApp(mockMethods: Partial<{
  createInstance: ReturnType<typeof vi.fn>;
  getInstance: ReturnType<typeof vi.fn>;
  listInstances: ReturnType<typeof vi.fn>;
  updateInstance: ReturnType<typeof vi.fn>;
  deleteInstance: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
}>): Hono {
  vi.mocked(ConnectorService).mockImplementation(() => mockMethods as InstanceType<typeof ConnectorService>);
  const fakeSql = {} as Parameters<typeof createConnectorRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/connectors', createConnectorRoutes(fakeSql));
  return app;
}

beforeEach(() => vi.clearAllMocks());

// ─── GET /types ───────────────────────────────────────────────────────────────

describe('GET /api/v1/connectors/types', () => {
  it('returns 200 with manifest list', async () => {
    vi.mocked(registry.list).mockReturnValue([MANIFEST as never]);
    const app = makeApp({});
    const res = await app.request('/api/v1/connectors/types');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof MANIFEST[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe('hubspot');
  });
});

describe('GET /api/v1/connectors/types/:connectorId', () => {
  it('returns 200 with manifest when found', async () => {
    vi.mocked(registry.get).mockReturnValue(MANIFEST as never);
    const app = makeApp({});
    const res = await app.request('/api/v1/connectors/types/hubspot');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof MANIFEST };
    expect(body.data.id).toBe('hubspot');
  });

  it('returns 404 when connector type not found', async () => {
    vi.mocked(registry.get).mockReturnValue(undefined as never);
    const app = makeApp({});
    const res = await app.request('/api/v1/connectors/types/unknown');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ─── GET / (list instances) ───────────────────────────────────────────────────

describe('GET /api/v1/connectors', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/connectors');
    expect(res.status).toBe(400);
  });

  it('returns 200 with instance list', async () => {
    const { ok } = await import('neverthrow');
    const listInstances = vi.fn().mockResolvedValue(ok([FAKE_INSTANCE]));
    const app = makeApp({ listInstances });
    const res = await app.request(`/api/v1/connectors?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_INSTANCE[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.connectorId).toBe('hubspot');
  });

  it('returns 500 when service errors', async () => {
    const { err } = await import('neverthrow');
    const listInstances = vi.fn().mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp({ listInstances });
    const res = await app.request(`/api/v1/connectors?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
  });
});

// ─── POST / (create instance) ─────────────────────────────────────────────────

describe('POST /api/v1/connectors', () => {
  it('returns 400 on invalid request body', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when connectorId type is not registered', async () => {
    vi.mocked(registry.get).mockReturnValue(undefined as never);
    const app = makeApp({});
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, connectorId: 'nonexistent', config: {} }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when config validation fails', async () => {
    vi.mocked(registry.get).mockReturnValue(MANIFEST as never);
    const { ConnectorError } = await import('@iris/connector-sdk');
    vi.mocked(registry.validateConfig).mockImplementation(() => {
      throw new ConnectorError('portalId is required', 'INVALID_CONFIG', false);
    });
    const app = makeApp({});
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, connectorId: 'hubspot', config: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain('portalId');
  });

  it('returns 201 with created instance', async () => {
    const { ok } = await import('neverthrow');
    vi.mocked(registry.get).mockReturnValue(MANIFEST as never);
    vi.mocked(registry.validateConfig).mockReturnValue({ portalId: '123' });
    const createInstance = vi.fn().mockResolvedValue(ok(FAKE_INSTANCE));
    const app = makeApp({ createInstance });
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, connectorId: 'hubspot', config: { portalId: '123' } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof FAKE_INSTANCE };
    expect(body.data.id).toBe(INSTANCE_ID);
    expect(body.data.status).toBe('active');
  });

  it('returns 500 when DB insertion fails', async () => {
    const { err } = await import('neverthrow');
    vi.mocked(registry.get).mockReturnValue(MANIFEST as never);
    vi.mocked(registry.validateConfig).mockReturnValue({});
    const createInstance = vi.fn().mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp({ createInstance });
    const res = await app.request('/api/v1/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, connectorId: 'hubspot', config: {} }),
    });
    expect(res.status).toBe(500);
  });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/connectors/:id', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}`);
    expect(res.status).toBe(400);
  });

  it('returns 200 with instance when found', async () => {
    const { ok } = await import('neverthrow');
    const getInstance = vi.fn().mockResolvedValue(ok(FAKE_INSTANCE));
    const app = makeApp({ getInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_INSTANCE };
    expect(body.data.id).toBe(INSTANCE_ID);
  });

  it('returns 404 when instance not found', async () => {
    const { ok } = await import('neverthrow');
    const getInstance = vi.fn().mockResolvedValue(ok(null));
    const app = makeApp({ getInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(404);
  });
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

describe('PUT /api/v1/connectors/:id', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with updated instance', async () => {
    const { ok } = await import('neverthrow');
    const updated = { ...FAKE_INSTANCE, config: { portalId: '456' } };
    const updateInstance = vi.fn().mockResolvedValue(ok(updated));
    const app = makeApp({ updateInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}?workspaceId=${WORKSPACE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { portalId: '456' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof updated };
    expect(body.data.config).toEqual({ portalId: '456' });
  });

  it('returns 404 when instance not found', async () => {
    const { ok } = await import('neverthrow');
    const updateInstance = vi.fn().mockResolvedValue(ok(null));
    const app = makeApp({ updateInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}?workspaceId=${WORKSPACE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: {} }),
    });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

describe('DELETE /api/v1/connectors/:id', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('returns 200 when deleted', async () => {
    const { ok } = await import('neverthrow');
    const deleteInstance = vi.fn().mockResolvedValue(ok(true));
    const app = makeApp({ deleteInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}?workspaceId=${WORKSPACE}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it('returns 404 when not found', async () => {
    const { ok } = await import('neverthrow');
    const deleteInstance = vi.fn().mockResolvedValue(ok(false));
    const app = makeApp({ deleteInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}?workspaceId=${WORKSPACE}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

// ─── POST /:id/sync ───────────────────────────────────────────────────────────

describe('POST /api/v1/connectors/:id/sync', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}/sync`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when instance not found', async () => {
    const { ok } = await import('neverthrow');
    const getInstance = vi.fn().mockResolvedValue(ok(null));
    const app = makeApp({ getInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}/sync?workspaceId=${WORKSPACE}`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 200 with syncing status when triggered', async () => {
    const { ok } = await import('neverthrow');
    const getInstance = vi.fn().mockResolvedValue(ok(FAKE_INSTANCE));
    const updateStatus = vi.fn().mockResolvedValue(ok(undefined));
    const app = makeApp({ getInstance, updateStatus });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}/sync?workspaceId=${WORKSPACE}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('syncing');
    expect(updateStatus).toHaveBeenCalledWith(INSTANCE_ID, 'syncing');
  });
});

// ─── POST /:id/test ───────────────────────────────────────────────────────────

describe('POST /api/v1/connectors/:id/test', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}/test`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('returns 200 with healthy:true when instance found', async () => {
    const { ok } = await import('neverthrow');
    const getInstance = vi.fn().mockResolvedValue(ok(FAKE_INSTANCE));
    const app = makeApp({ getInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}/test?workspaceId=${WORKSPACE}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { healthy: boolean } };
    expect(body.data.healthy).toBe(true);
  });

  it('returns 404 when instance not found', async () => {
    const { ok } = await import('neverthrow');
    const getInstance = vi.fn().mockResolvedValue(ok(null));
    const app = makeApp({ getInstance });
    const res = await app.request(`/api/v1/connectors/${INSTANCE_ID}/test?workspaceId=${WORKSPACE}`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
