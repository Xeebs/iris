import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { MCPSubscriptionManager, createSubscriptionSchema } from '@iris/semantic-core/mcp-subscriptions';

type SqlClient = ReturnType<typeof postgres>;

const unsubscribeSchema = z.object({
  workspaceId: z.string().min(1),
});

/**
 * REST routes for MCP subscription management.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted at /mcp
 */
export function createMcpSubscriptionRoutes(sql: SqlClient) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mgr = () => new MCPSubscriptionManager(sql as unknown as any);

  /** POST /mcp/subscribe — create a new subscription */
  app.post('/subscribe', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'INVALID_JSON', message: 'Request body must be JSON' } }, 400);
    }

    const parsed = createSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message, details: parsed.error.issues } }, 400);
    }

    const result = await mgr().subscribe(parsed.data);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** DELETE /mcp/subscriptions/:id — remove a subscription */
  app.delete('/subscriptions/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = unsubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const result = await mgr().unsubscribe(id, parsed.data.workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { deleted: true } });
  });

  /** GET /mcp/subscriptions?workspaceId= — list subscriptions */
  app.get('/subscriptions', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } }, 400);
    }

    const result = await mgr().listSubscriptions(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /mcp/subscriptions/:id/events?limit= */
  app.get('/subscriptions/:id/events', async (c) => {
    const id = c.req.param('id');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);

    const result = await mgr().listEvents(id, limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
