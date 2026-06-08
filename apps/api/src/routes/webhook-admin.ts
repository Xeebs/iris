import { Hono } from 'hono';
import { z } from 'zod';
import { WebhookDebugger } from '@iris/semantic-core/webhook-debugger';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ route: 'webhook-admin' });

const testDeliverySchema = z.object({
  payload: z.record(z.unknown()).default({}),
});

/**
 * @param sql - Tagged template SQL function
 * @returns Hono router for webhook admin endpoints
 */
export function createWebhookAdminRoutes(sql: SqlFn) {
  const app = new Hono();
  const debugger_ = new WebhookDebugger(sql);

  // GET /admin/webhooks — list all webhooks for workspace
  app.get('/admin/webhooks', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const limit = Math.min(200, parseInt(c.req.query('limit') ?? '50', 10));
    const result = await debugger_.listWebhooks(workspaceId, limit);
    if (result.isErr()) {
      log.error('Failed to list webhooks', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // GET /admin/webhooks/:id/deliveries — delivery history for one webhook
  app.get('/admin/webhooks/:id/deliveries', async (c) => {
    const webhookId = c.req.param('id');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const limit = Math.min(200, parseInt(c.req.query('limit') ?? '50', 10));
    const result = await debugger_.getDeliveries(webhookId, workspaceId, limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'DELIVERIES_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // POST /admin/webhooks/:id/test-delivery — fire a test delivery
  app.post('/admin/webhooks/:id/test-delivery', async (c) => {
    const webhookId = c.req.param('id');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => ({})) as unknown;
    const parsed = testDeliverySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload' } }, 400);
    }
    const result = await debugger_.testDelivery(webhookId, workspaceId, parsed.data.payload);
    if (result.isErr()) {
      const isNotFound = result.error.message.includes('not found');
      log.error('Test delivery failed', { webhookId, error: result.error.message });
      return c.json({ error: { code: 'TEST_FAILED', message: result.error.message } }, isNotFound ? 404 : 500);
    }
    log.info('Test delivery completed', { webhookId, success: result.value.success });
    return c.json({ data: result.value }, 201);
  });

  // POST /admin/webhooks/:id/retry/:deliveryId — retry a failed delivery
  app.post('/admin/webhooks/:id/retry/:deliveryId', async (c) => {
    const deliveryId = c.req.param('deliveryId');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const result = await debugger_.retryDelivery(deliveryId, workspaceId);
    if (result.isErr()) {
      const isNotFound = result.error.message.includes('not found');
      return c.json({ error: { code: 'RETRY_FAILED', message: result.error.message } }, isNotFound ? 404 : 500);
    }
    log.info('Delivery retried', { deliveryId, success: result.value.success });
    return c.json({ data: result.value }, 201);
  });

  // GET /admin/webhooks/retry-queue — failed deliveries pending retry
  app.get('/admin/webhooks/retry-queue', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const result = await debugger_.getRetryQueue(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'QUEUE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
