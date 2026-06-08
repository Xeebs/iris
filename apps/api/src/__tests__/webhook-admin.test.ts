import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createWebhookAdminRoutes } from '../routes/webhook-admin.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/webhook-debugger', () => {
  const mockDebugger = {
    listWebhooks: vi.fn(),
    getDeliveries: vi.fn(),
    testDelivery: vi.fn(),
    retryDelivery: vi.fn(),
    getRetryQueue: vi.fn(),
  };
  return {
    WebhookDebugger: vi.fn(() => mockDebugger),
    _mockDebugger: mockDebugger,
  };
});

import { _mockDebugger as mockDebugger } from '@iris/semantic-core/webhook-debugger';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createWebhookAdminRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/', createWebhookAdminRoutes(sqlMock));
  return app;
}

beforeEach(() => { vi.clearAllMocks(); });

const webhookFixture = {
  webhookId: 'wh-1', workspaceId: 'ws-test', targetUrl: 'https://example.com/hook',
  eventTypes: ['contact.created'], active: true, signingSecret: 'secret',
  createdAt: new Date(), lastDeliveryAt: null, lastDeliverySuccess: null,
};

const deliveryFixture = {
  deliveryId: 'd-1', webhookId: 'wh-1', eventType: 'contact.created',
  targetUrl: 'https://example.com/hook', statusCode: 200, latencyMs: 120,
  success: true, requestBody: '{}', responseBody: 'ok',
  errorMessage: null, deliveredAt: new Date(), retryCount: 0,
};

describe('GET /admin/webhooks', () => {
  it('lists webhooks', async () => {
    mockDebugger.listWebhooks.mockResolvedValueOnce(ok([webhookFixture]));
    const res = await makeApp().request('/admin/webhooks');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('returns 500 on error', async () => {
    mockDebugger.listWebhooks.mockResolvedValueOnce(err(new Error('db error')));
    const res = await makeApp().request('/admin/webhooks');
    expect(res.status).toBe(500);
  });
});

describe('GET /admin/webhooks/:id/deliveries', () => {
  it('returns delivery history', async () => {
    mockDebugger.getDeliveries.mockResolvedValueOnce(ok([deliveryFixture]));
    const res = await makeApp().request('/admin/webhooks/wh-1/deliveries');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('POST /admin/webhooks/:id/test-delivery', () => {
  it('fires test delivery and returns 201', async () => {
    mockDebugger.testDelivery.mockResolvedValueOnce(ok(deliveryFixture));
    const res = await makeApp().request('/admin/webhooks/wh-1/test-delivery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { event: 'test', data: {} } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { deliveryId: string } };
    expect(body.data.deliveryId).toBe('d-1');
  });

  it('returns 404 when webhook not found', async () => {
    mockDebugger.testDelivery.mockResolvedValueOnce(err(new Error('Webhook not found')));
    const res = await makeApp().request('/admin/webhooks/bad/test-delivery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/webhooks/:id/retry/:deliveryId', () => {
  it('retries delivery and returns 201', async () => {
    const retried = { ...deliveryFixture, deliveryId: 'd-2', retryCount: 1 };
    mockDebugger.retryDelivery.mockResolvedValueOnce(ok(retried));
    const res = await makeApp().request('/admin/webhooks/wh-1/retry/d-1', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { retryCount: number } };
    expect(body.data.retryCount).toBe(1);
  });

  it('returns 404 when delivery not found', async () => {
    mockDebugger.retryDelivery.mockResolvedValueOnce(err(new Error('Delivery not found')));
    const res = await makeApp().request('/admin/webhooks/wh-1/retry/bad', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('GET /admin/webhooks/retry-queue', () => {
  it('returns failed deliveries', async () => {
    const failed = { ...deliveryFixture, success: false, retryCount: 1 };
    mockDebugger.getRetryQueue.mockResolvedValueOnce(ok([failed]));
    const res = await makeApp().request('/admin/webhooks/retry-queue');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});
