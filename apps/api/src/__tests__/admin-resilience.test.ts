import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/queue/connector-resilience', () => ({
  ConnectorResilienceManager: vi.fn().mockImplementation(() => ({
    getAllMetrics: vi.fn().mockReturnValue([]),
    getMetrics: vi.fn().mockReturnValue({
      connectorId: 'hubspot', retryCount: 2, timeoutCount: 1,
      circuitBreakerTrips: 0, successCount: 10, failureCount: 3,
      lastFailureAt: null, circuitState: 'closed',
    }),
    getPolicy: vi.fn().mockResolvedValue({
      connectorId: 'hubspot', maxRetries: 3, backoffStrategy: 'exponential',
      baseDelayMs: 1000, maxDelayMs: 60000, jitterFactor: 0.2,
      circuitBreakerThreshold: 0.5, circuitCooldownMs: 30000,
      timeoutMs: 10000, maxConcurrent: 10,
    }),
    setPolicy: vi.fn().mockResolvedValue(undefined),
    resetConnector: vi.fn(),
  })),
}));

import { ConnectorResilienceManager } from '@iris/queue/connector-resilience';
import { createAdminResilienceRoutes } from '../routes/admin-resilience.js';

function makeApp(): Hono {
  const fakeSql = {} as Parameters<typeof createAdminResilienceRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/admin/connectors/resilience', createAdminResilienceRoutes(fakeSql));
  return app;
}

function getInstance() {
  return vi.mocked(ConnectorResilienceManager).mock.results.at(-1)!.value as Record<string, ReturnType<typeof vi.fn>>;
}

describe('GET /api/v1/admin/connectors/resilience', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all connector metrics', async () => {
    const app = makeApp();
    const inst = getInstance();
    inst['getAllMetrics'].mockReturnValue([{ connectorId: 'hubspot', retryCount: 1 }]);
    const res = await app.request('/api/v1/admin/connectors/resilience');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('GET /api/v1/admin/connectors/resilience/:connectorId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns metrics and policy for a connector', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/admin/connectors/resilience/hubspot');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { metrics: unknown; policy: unknown } };
    expect(body.data.metrics).toBeDefined();
    expect(body.data.policy).toBeDefined();
  });
});

describe('PUT /api/v1/admin/connectors/resilience/:connectorId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates policy and returns 200', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/admin/connectors/resilience/hubspot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxRetries: 5, backoffStrategy: 'linear' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { updated: boolean } };
    expect(body.data.updated).toBe(true);
  });

  it('returns 400 for invalid policy params', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/admin/connectors/resilience/hubspot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxRetries: 999, backoffStrategy: 'invalid-strategy' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/admin/connectors/resilience/hubspot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/admin/connectors/resilience/:connectorId/reset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resets a connector circuit and returns 200', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/admin/connectors/resilience/hubspot/reset', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reset: boolean } };
    expect(body.data.reset).toBe(true);
  });
});
