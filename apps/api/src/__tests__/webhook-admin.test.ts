import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createWebhookAdminRoutes } from '../routes/webhook-admin.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  },
}));

const mockDebugger = {
  listWebhooks: vi.fn(),
  getDeliveries: vi.fn(),
  testDelivery: vi.fn(),
  retryDelivery: vi.fn(),
  getRetryQueue: vi.fn(),
};

vi.mock('@iris/semantic-core/webhook-debugger', () => ({
  WebhookDebugger: vi.fn(() => mockDebugger),
}));

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<
  typeof createWebhookAdminRoutes
>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/', createWebhookAdminRoutes(sqlMock));
  return app;
}

const webhookFixture = {
  webhookId: 'wh-1',
  workspaceId: 'ws-test',
  targetUrl: 'https://example.com/hook',
  eventTypes: ['contact.created'],
  active: true,
  signingSecret: 'secret',
  createdAt: new Date(),
  lastDeliveryAt: null,
  lastDeliverySuccess: null,
};

const deliveryFixture = {
  deliveryId: 'd-1',
  webhookId: 'wh-1',
  eventType: 'contact.created',
  targetUrl: 'https://example.com/hook',
  statusCode: 200,
  latencyMs: 120,
  success: true,
  requestBody: '{"event":"contact.created"}',
  responseBody: 'ok',
  errorMessage: null,
  deliveredAt: new Date(),
  retryCount: 0,
};

const failedDelivery = {
  ...deliveryFixture,
  deliveryId: 'd-fail',
  success: false,
  statusCode: 503,
  errorMessage: 'Service unavailable',
  retryCount: 2,
};

describe('webhook-admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /admin/webhooks', () => {
    it('lists all webhooks for workspace', async () => {
      mockDebugger.listWebhooks.mockResolvedValueOnce(ok([webhookFixture]));
      const res = await makeApp().request('/admin/webhooks');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns empty array when no webhooks exist', async () => {
      mockDebugger.listWebhooks.mockResolvedValueOnce(ok([]));
      const res = await makeApp().request('/admin/webhooks');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('returns 500 when listing fails', async () => {
      mockDebugger.listWebhooks.mockResolvedValueOnce(err(new Error('DB error')));
      const res = await makeApp().request('/admin/webhooks');
      expect(res.status).toBe(500);
    });

    it('respects limit query param', async () => {
      mockDebugger.listWebhooks.mockResolvedValueOnce(ok([]));
      await makeApp().request('/admin/webhooks?limit=100');
      expect(mockDebugger.listWebhooks).toHaveBeenCalledWith('ws-test', 100);
    });

    it('defaults to limit 50', async () => {
      mockDebugger.listWebhooks.mockResolvedValueOnce(ok([]));
      await makeApp().request('/admin/webhooks');
      expect(mockDebugger.listWebhooks).toHaveBeenCalledWith('ws-test', 50);
    });

    it('caps limit at 200', async () => {
      mockDebugger.listWebhooks.mockResolvedValueOnce(ok([]));
      await makeApp().request('/admin/webhooks?limit=999');
      const callArgs = mockDebugger.listWebhooks.mock.calls[0] as [string, number];
      expect(callArgs[1]).toBeLessThanOrEqual(200);
    });
  });

  describe('GET /admin/webhooks/:id/deliveries', () => {
    it('returns delivery history for webhook', async () => {
      mockDebugger.getDeliveries.mockResolvedValueOnce(ok([deliveryFixture, failedDelivery]));
      const res = await makeApp().request('/admin/webhooks/wh-1/deliveries');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(2);
    });

    it('returns empty array when no deliveries', async () => {
      mockDebugger.getDeliveries.mockResolvedValueOnce(ok([]));
      const res = await makeApp().request('/admin/webhooks/wh-new/deliveries');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('returns 500 when delivery lookup fails', async () => {
      mockDebugger.getDeliveries.mockResolvedValueOnce(err(new Error('DB error')));
      const res = await makeApp().request('/admin/webhooks/wh-1/deliveries');
      expect(res.status).toBe(500);
    });

    it('passes webhookId and workspaceId to service', async () => {
      mockDebugger.getDeliveries.mockResolvedValueOnce(ok([]));
      await makeApp().request('/admin/webhooks/my-hook/deliveries');
      expect(mockDebugger.getDeliveries).toHaveBeenCalledWith('my-hook', 'ws-test', 50);
    });

    it('respects limit query param', async () => {
      mockDebugger.getDeliveries.mockResolvedValueOnce(ok([]));
      await makeApp().request('/admin/webhooks/wh-1/deliveries?limit=10');
      expect(mockDebugger.getDeliveries).toHaveBeenCalledWith('wh-1', 'ws-test', 10);
    });
  });

  describe('POST /admin/webhooks/:id/test-delivery', () => {
    it('fires test delivery and returns 201', async () => {
      mockDebugger.testDelivery.mockResolvedValueOnce(ok(deliveryFixture));
      const res = await makeApp().request('/admin/webhooks/wh-1/test-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { event: 'test' } }),
      });
      expect(res.status).toBe(201);
    });

    it('returns deliveryId in response', async () => {
      mockDebugger.testDelivery.mockResolvedValueOnce(ok(deliveryFixture));
      const res = await makeApp().request('/admin/webhooks/wh-1/test-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: {} }),
      });
      const body = await res.json() as { data: { deliveryId: string } };
      expect(body.data.deliveryId).toBe('d-1');
    });

    it('returns 404 when webhook is not found', async () => {
      mockDebugger.testDelivery.mockResolvedValueOnce(err(new Error('Webhook not found')));
      const res = await makeApp().request('/admin/webhooks/bad/test-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it('returns 500 for non-404 delivery errors', async () => {
      mockDebugger.testDelivery.mockResolvedValueOnce(err(new Error('Timeout')));
      const res = await makeApp().request('/admin/webhooks/wh-1/test-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(500);
    });

    it('accepts empty payload body', async () => {
      mockDebugger.testDelivery.mockResolvedValueOnce(ok(deliveryFixture));
      const res = await makeApp().request('/admin/webhooks/wh-1/test-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(201);
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

    it('returns 404 when delivery is not found', async () => {
      mockDebugger.retryDelivery.mockResolvedValueOnce(err(new Error('Delivery not found')));
      const res = await makeApp().request('/admin/webhooks/wh-1/retry/bad', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 500 for non-404 retry errors', async () => {
      mockDebugger.retryDelivery.mockResolvedValueOnce(err(new Error('Target unavailable')));
      const res = await makeApp().request('/admin/webhooks/wh-1/retry/d-1', { method: 'POST' });
      expect(res.status).toBe(500);
    });

    it('passes deliveryId and workspaceId to service', async () => {
      mockDebugger.retryDelivery.mockResolvedValueOnce(ok(deliveryFixture));
      await makeApp().request('/admin/webhooks/wh-1/retry/d-test', { method: 'POST' });
      expect(mockDebugger.retryDelivery).toHaveBeenCalledWith('d-test', 'ws-test');
    });
  });

  describe('GET /admin/webhooks/retry-queue', () => {
    it('returns list of failed deliveries pending retry', async () => {
      mockDebugger.getRetryQueue.mockResolvedValueOnce(ok([failedDelivery]));
      const res = await makeApp().request('/admin/webhooks/retry-queue');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns empty array when no deliveries are queued', async () => {
      mockDebugger.getRetryQueue.mockResolvedValueOnce(ok([]));
      const res = await makeApp().request('/admin/webhooks/retry-queue');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('returns 500 when queue fetch fails', async () => {
      mockDebugger.getRetryQueue.mockResolvedValueOnce(err(new Error('Queue error')));
      const res = await makeApp().request('/admin/webhooks/retry-queue');
      expect(res.status).toBe(500);
    });

    it('passes workspaceId to service', async () => {
      mockDebugger.getRetryQueue.mockResolvedValueOnce(ok([]));
      await makeApp().request('/admin/webhooks/retry-queue');
      expect(mockDebugger.getRetryQueue).toHaveBeenCalledWith('ws-test');
    });
  });
});
