import { Hono } from 'hono';
import { z } from 'zod';
import {
  getEventStreamConfig,
  upsertEventStreamConfig,
  getEventAuditLog,
  enqueueChangeEvent,
  markEventFailed,
  getPendingRetryEvents,
} from '@iris/semantic-core/event-driven-sync-engine';
import type { ChangeType } from '@iris/semantic-core/event-driven-sync-engine';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'event-streams' });

type Sql = Parameters<typeof getEventStreamConfig>[0];
type SqlBindings = { sql: Sql };

const app = new Hono<{ Bindings: SqlBindings }>();

function getSql(c: { env: unknown }) {
  return (c.env as SqlBindings | undefined)?.sql;
}

const EventConfigSchema = z.object({
  enabled: z.boolean(),
  eventTypes: z.array(z.enum(['entity_created', 'entity_updated', 'entity_deleted', 'relationship_changed'])),
  configJson: z.record(z.unknown()).optional(),
});

const EnqueueEventSchema = z.object({
  eventId: z.string().min(1),
  entityId: z.string().min(1),
  entityType: z.string().min(1),
  changeType: z.enum(['entity_created', 'entity_updated', 'entity_deleted', 'relationship_changed']),
  payload: z.record(z.unknown()).optional(),
  schemaVersion: z.string().optional(),
});

/** GET /connectors/:connectorId/event-config — get stream settings */
app.get('/connectors/:connectorId/event-config', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const connectorId = c.req.param('connectorId');

  const sql = getSql(c);
  const result = await getEventStreamConfig(sql!, workspaceId, connectorId);

  if (result.isErr()) {
    log.error('Failed to get event stream config', { error: result.error.message });
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load config' } }, 500);
  }

  return c.json({ data: result.value ?? { connectorId, workspaceId, enabled: false, eventTypes: [], configJson: {} } });
});

/** PUT /connectors/:connectorId/event-config — enable/configure stream */
app.put('/connectors/:connectorId/event-config', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const connectorId = c.req.param('connectorId');

  const body = await c.req.json().catch(() => ({}));
  const parsed = EventConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid config', details: parsed.error.format() } }, 400);
  }

  const sql = getSql(c);
  const result = await upsertEventStreamConfig(sql!, {
    connectorId,
    workspaceId,
    enabled: parsed.data.enabled,
    eventTypes: parsed.data.eventTypes as ChangeType[],
    configJson: parsed.data.configJson ?? {},
  });

  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to update config' } }, 500);
  }

  return c.json({ data: { connectorId, enabled: parsed.data.enabled } });
});

/** POST /connectors/:connectorId/events — enqueue a change event */
app.post('/connectors/:connectorId/events', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const connectorId = c.req.param('connectorId');

  const body = await c.req.json().catch(() => ({}));
  const parsed = EnqueueEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid event payload', details: parsed.error.format() } }, 400);
  }

  const sql = getSql(c);
  const result = await enqueueChangeEvent(sql!, {
    eventId: parsed.data.eventId,
    connectorId,
    workspaceId,
    entityId: parsed.data.entityId,
    entityType: parsed.data.entityType,
    changeType: parsed.data.changeType as ChangeType,
    payload: parsed.data.payload ?? {},
    occurredAt: new Date(),
    schemaVersion: parsed.data.schemaVersion ?? '1',
  });

  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to enqueue event' } }, 500);
  }

  return c.json({ data: { eventId: parsed.data.eventId, status: 'pending' } }, 201);
});

/** GET /events/audit — cursor-paginated event audit history */
app.get('/events/audit', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const cursor = c.req.query('cursor');

  const sql = getSql(c);
  const result = await getEventAuditLog(sql!, workspaceId, limit, cursor);

  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load audit log' } }, 500);
  }

  return c.json({
    data: result.value.entries,
    meta: { hasMore: result.value.nextCursor !== null, nextCursor: result.value.nextCursor },
  });
});

/** POST /events/:eventId/retry — manually retry a failed event */
app.post('/events/:eventId/retry', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const eventId = c.req.param('eventId');

  const sql = getSql(c);

  // Reset retry status so it gets picked up by the worker
  const result = await markEventFailed(sql!, workspaceId, eventId, 999);

  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to schedule retry' } }, 500);
  }

  return c.json({ data: { eventId, scheduled: true } });
});

/** GET /events/pending-retry — list events awaiting retry */
app.get('/events/pending-retry', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

  const sql = getSql(c);
  const result = await getPendingRetryEvents(sql!, workspaceId, limit);

  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load retry queue' } }, 500);
  }

  return c.json({ data: result.value, meta: { count: result.value.length } });
});

export default app;
