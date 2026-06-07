import { createHmac, timingSafeEqual } from 'crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'webhooks' });

type SqlClient = ReturnType<typeof postgres>;

type ConnectorInstanceRow = {
  id: string;
  workspace_id: string;
  connector_id: string;
  webhook_secret: string | null;
};

type SemanticEntityDelta = {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
};

// ─── HubSpot ──────────────────────────────────────────────────────────────────

type HubSpotEvent = {
  subscriptionType: string;
  objectId: number;
  occurredAt: number;
  propertyName?: string;
  propertyValue?: string;
};

function validateHubSpotSignature(clientSecret: string, rawBody: string, signature: string): boolean {
  const expected = createHmac('sha256', clientSecret).update(rawBody).digest('hex');
  return expected === signature;
}

function hubSpotEventsToDeltas(events: HubSpotEvent[]): SemanticEntityDelta[] {
  return events
    .filter((e) => e.propertyName !== undefined)
    .map((e) => {
      const type = e.subscriptionType.includes('contact')
        ? 'contact'
        : e.subscriptionType.includes('company')
          ? 'company'
          : e.subscriptionType.includes('deal')
            ? 'deal'
            : 'object';
      return {
        id: `hubspot:${type}:${e.objectId}`,
        type,
        label: `${type} ${e.objectId}`,
        attributes: { [e.propertyName!]: e.propertyValue ?? null },
      };
    });
}

// ─── Slack ────────────────────────────────────────────────────────────────────

type SlackPayload = {
  type: string;
  challenge?: string;
  event?: {
    type: string;
    channel?: string;
    user?: string;
    text?: string;
    ts?: string;
    event_ts?: string;
  };
};

function validateSlackSignature(signingSecret: string, rawBody: string, timestamp: string, signature: string): boolean {
  const reqTime = parseInt(timestamp, 10);
  if (isNaN(reqTime) || Math.abs(Date.now() / 1000 - reqTime) > 300) return false;

  const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function slackEventToDelta(payload: SlackPayload): SemanticEntityDelta | null {
  if (payload.type !== 'event_callback' || !payload.event) return null;
  const { event } = payload;
  if (event.type !== 'message' || !event.channel || !event.ts) return null;
  return {
    id: `slack:message:${event.channel}:${event.ts}`,
    type: 'message',
    label: event.text ? event.text.slice(0, 80) : 'Slack message',
    attributes: { channel: event.channel, author: event.user ?? null, text: event.text ?? null },
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

async function resolveInstance(sql: SqlClient, instanceId: string, secret: string): Promise<ConnectorInstanceRow | null> {
  const rows = await sql<ConnectorInstanceRow[]>`
    SELECT id, workspace_id, connector_id, webhook_secret
    FROM connector_instances
    WHERE id = ${instanceId}
      AND webhook_secret = ${secret}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * @param sql - Postgres client for connector instance lookup
 */
export function createWebhookRoutes(sql: SqlClient): Hono {
  const routes = new Hono();

  /**
   * POST /api/v1/webhooks/:connectorInstanceId/:secret
   * Receives webhook events from external services (HubSpot, Slack, etc.).
   * The URL secret enables quick instance resolution; vendor-specific HMAC validates payload integrity.
   */
  routes.post('/:connectorInstanceId/:secret', async (c) => {
    const instanceId = c.req.param('connectorInstanceId');
    const secret = c.req.param('secret');

    let instance: ConnectorInstanceRow | null;
    try {
      instance = await resolveInstance(sql, instanceId, secret);
    } catch (e) {
      log.error('Failed to resolve webhook instance', { instanceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve instance' } }, 500);
    }

    if (!instance) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Invalid instance or secret' } }, 404);
    }

    const rawBody = await c.req.text();
    let deltas: SemanticEntityDelta[] = [];

    if (instance.connector_id === 'hubspot') {
      const clientSecret = process.env['HUBSPOT_CLIENT_SECRET'] ?? '';
      const signature = c.req.header('x-hubspot-signature') ?? '';

      if (!signature || !validateHubSpotSignature(clientSecret, rawBody, signature)) {
        log.warn('Invalid HubSpot webhook signature', { instanceId });
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } }, 401);
      }

      const events = JSON.parse(rawBody) as HubSpotEvent[];
      deltas = hubSpotEventsToDeltas(Array.isArray(events) ? events : []);
      log.info('HubSpot webhook received', { instanceId, eventCount: events.length, entityCount: deltas.length });

    } else if (instance.connector_id === 'slack') {
      const signingSecret = process.env['SLACK_SIGNING_SECRET'] ?? '';
      const timestamp = c.req.header('x-slack-request-timestamp') ?? '';
      const signature = c.req.header('x-slack-signature') ?? '';

      if (!timestamp || !signature || !validateSlackSignature(signingSecret, rawBody, timestamp, signature)) {
        log.warn('Invalid Slack webhook signature', { instanceId });
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } }, 401);
      }

      const payload = JSON.parse(rawBody) as SlackPayload;

      // Handle Slack URL verification challenge (no secret check needed for challenge)
      if (payload.type === 'url_verification' && payload.challenge) {
        return c.json({ challenge: payload.challenge });
      }

      const delta = slackEventToDelta(payload);
      if (delta) deltas = [delta];
      log.info('Slack webhook received', { instanceId, eventType: payload.event?.type, entityCount: deltas.length });

    } else {
      log.warn('Unsupported connector for webhooks', { connectorId: instance.connector_id, instanceId });
      return c.json(
        { error: { code: 'NOT_SUPPORTED', message: `Webhooks not supported for "${instance.connector_id}"` } },
        422,
      );
    }

    return c.json({
      data: {
        instanceId,
        workspaceId: instance.workspace_id,
        entitiesQueued: deltas.length,
      },
    });
  });

  return routes;
}

type WebhookEventRow = {
  id: string;
  workspace_id: string;
  webhook_id: string;
  event_type: string;
  target_url: string;
  status: string;
  attempt_count: number;
  http_status: number | null;
  error_message: string | null;
  next_retry_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * Authenticated routes for webhook event delivery status.
 * Mount at /api/v1/webhooks (authed).
 *
 * @param sql - Postgres client
 */
export function createWebhookEventsRoutes(sql: SqlClient) {
  const app = new Hono();

  /** GET /events?workspaceId=&status=&limit=&cursor= */
  app.get('/events', async (c) => {
    const parsed = z.object({
      workspaceId: z.string().min(1),
      status: z.enum(['pending', 'delivered', 'failed', 'dead']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      cursor: z.string().optional(),
    }).safeParse({
      workspaceId: c.req.query('workspaceId'),
      status: c.req.query('status'),
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
    });
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { workspaceId, status, limit, cursor } = parsed.data;

    try {
      const rows = await sql<WebhookEventRow[]>`
        SELECT * FROM webhook_events
        WHERE workspace_id = ${workspaceId}
          ${status ? sql`AND status = ${status}` : sql``}
          ${cursor ? sql`AND id < ${cursor}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${limit + 1}
      `;
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

      return c.json({
        data: data.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          webhookId: r.webhook_id,
          eventType: r.event_type,
          targetUrl: r.target_url,
          status: r.status,
          attemptCount: r.attempt_count,
          httpStatus: r.http_status,
          errorMessage: r.error_message,
          nextRetryAt: r.next_retry_at,
          completedAt: r.completed_at,
          createdAt: r.created_at,
        })),
        meta: { hasMore, nextCursor },
      });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: String(e) } }, 500);
    }
  });

  return app;
}
