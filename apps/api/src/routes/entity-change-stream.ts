import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { stream } from 'hono/streaming';
import type { Sql } from 'postgres';

import { logger } from '@iris/core/logger';
import { EntityChangeStreamManager } from '@iris/semantic-core/entity-change-stream';

const SubscriptionBodySchema = z.object({
  entityId: z.string().nullable().default(null),
  filters: z.object({
    entityTypes: z.array(z.string()).optional(),
    changeTypes: z.array(z.enum(['created', 'updated', 'deleted', 'attribute_changed'])).optional(),
    connectorIds: z.array(z.string()).optional(),
  }).default({}),
});

const EmitBodySchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string().min(1),
  changeType: z.enum(['created', 'updated', 'deleted', 'attribute_changed']),
  previousValue: z.record(z.unknown()).nullable().default(null),
  newValue: z.record(z.unknown()).nullable().default(null),
  source: z.string().default(''),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for entity change stream and subscriptions
 */
export function createEntityChangeStreamRoutes(sql: Sql) {
  const app = new Hono();
  const manager = new EntityChangeStreamManager(sql);

  /**
   * POST /entities/subscriptions — create a change subscription
   */
  app.post('/subscriptions', zValidator('json', SubscriptionBodySchema), async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const { entityId, filters } = c.req.valid('json');

    try {
      const sub = await manager.subscribeToEntityChanges(workspaceId, entityId, filters);
      return c.json({ data: sub }, 201);
    } catch (e) {
      logger.error('Failed to create subscription', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create subscription' } }, 500);
    }
  });

  /**
   * DELETE /entities/subscriptions/:subscriptionId — cancel a subscription
   */
  app.delete('/subscriptions/:subscriptionId', async (c) => {
    const subscriptionId = c.req.param('subscriptionId');

    try {
      await manager.unsubscribe(subscriptionId);
      return c.json({ data: { subscriptionId, cancelled: true } });
    } catch (e) {
      logger.error('Failed to cancel subscription', { subscriptionId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel subscription' } }, 500);
    }
  });

  /**
   * GET /entities/subscriptions — list active subscriptions for workspace
   */
  app.get('/subscriptions', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    try {
      const subscriptions = await manager.getActiveSubscriptions(workspaceId);
      return c.json({ data: subscriptions });
    } catch (e) {
      logger.error('Failed to list subscriptions', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list subscriptions' } }, 500);
    }
  });

  /**
   * GET /entities/:entityId/changes — recent change history with optional replay
   * Query: ?since=<ISO date>&limit=<n>
   */
  app.get('/:entityId/changes', async (c) => {
    const entityId = c.req.param('entityId');
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const sinceRaw = c.req.query('since');
    const limit = Math.min(200, Number(c.req.query('limit') ?? '50'));

    const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (isNaN(since.getTime())) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid since date' } }, 400);
    }

    try {
      const changes = await manager.replayChanges(entityId, workspaceId, since, limit);
      return c.json({ data: changes });
    } catch (e) {
      logger.error('Failed to replay changes', { entityId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to replay changes' } }, 500);
    }
  });

  /**
   * GET /entities/:entityId/changes/stream — SSE stream for live entity changes
   * The client must already have a subscription; this streams new events to it.
   */
  app.get('/:entityId/changes/stream', (c) => {
    const entityId = c.req.param('entityId');
    const subscriptionId = c.req.query('subscriptionId') ?? entityId;

    return stream(c, async (s) => {
      s.onAbort(() => {
        cleanup();
        logger.debug('SSE stream aborted', { subscriptionId });
      });

      const cleanup = manager.addListener(subscriptionId, (change) => {
        const payload = `data: ${JSON.stringify({
          changeId: change.changeId,
          entityId: change.entityId,
          changeType: change.changeType,
          notification: manager.createChangeNotification(change),
          changedAt: change.changedAt,
        })}\n\n`;
        void s.write(payload).catch(() => cleanup());
      });

      // Send initial heartbeat
      await s.write(': connected\n\n');

      // Keep connection alive — the stream stays open until the client disconnects
      await new Promise<void>((resolve) => {
        s.onAbort(resolve);
      });
    });
  });

  /**
   * POST /entities/changes — emit a change event (internal/testing endpoint)
   */
  app.post('/changes', zValidator('json', EmitBodySchema), async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const body = c.req.valid('json');

    try {
      const change = await manager.emitEntityChange({
        ...body,
        workspaceId,
        changedAt: new Date(),
      });
      return c.json({ data: { changeId: change.changeId, notification: manager.createChangeNotification(change) } }, 201);
    } catch (e) {
      logger.error('Failed to emit change', { error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to emit change' } }, 500);
    }
  });

  /**
   * GET /entities/changes — recent workspace-wide change feed
   * Query: ?entityType=<type>&limit=<n>
   */
  app.get('/changes', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const entityType = c.req.query('entityType') ?? null;
    const limit = Math.min(200, Number(c.req.query('limit') ?? '50'));

    try {
      const changes = await manager.getRecentChanges(workspaceId, entityType, limit);
      return c.json({ data: changes });
    } catch (e) {
      logger.error('Failed to get recent changes', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get recent changes' } }, 500);
    }
  });

  return app;
}
