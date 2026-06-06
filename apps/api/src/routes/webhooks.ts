import { createHmac, timingSafeEqual } from 'crypto';
import { Hono } from 'hono';
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
