import { createHmac, timingSafeEqual } from 'crypto';
import type { SemanticEntity } from '@iris/connector-sdk';

export type SlackEvent = {
  type: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string;
  event_ts?: string;
  username?: string;
};

export type SlackWebhookPayload = {
  type: 'event_callback' | 'url_verification';
  challenge?: string;
  team_id?: string;
  event?: SlackEvent;
  event_id?: string;
  event_time?: number;
};

export type WebhookValidationResult =
  | { valid: true; payload: SlackWebhookPayload }
  | { valid: false; reason: string };

/**
 * Validate Slack webhook signature using HMAC-SHA256.
 * Slack signs webhooks with: HMAC-SHA256(signingSecret, "v0:" + timestamp + ":" + body)
 * Compared against X-Slack-Signature header ("v0=" prefix).
 *
 * @param signingSecret - Slack app signing secret
 * @param rawBody       - Raw request body string
 * @param timestamp     - X-Slack-Request-Timestamp header value
 * @param signature     - X-Slack-Signature header value (format: "v0=<hex>")
 */
export function validateSlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
): boolean {
  // Reject requests older than 5 minutes (replay attack prevention)
  const reqTime = parseInt(timestamp, 10);
  if (isNaN(reqTime) || Math.abs(Date.now() / 1000 - reqTime) > 300) {
    return false;
  }

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', signingSecret).update(sigBase).digest('hex')}`;

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Parse and validate a Slack webhook payload.
 *
 * @param signingSecret - Slack app signing secret
 * @param rawBody       - Raw request body string
 * @param timestamp     - X-Slack-Request-Timestamp header value
 * @param signature     - X-Slack-Signature header value
 */
export function parseSlackWebhook(
  signingSecret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): WebhookValidationResult {
  if (!timestamp || !signature) {
    return { valid: false, reason: 'Missing Slack signature headers' };
  }

  if (!validateSlackSignature(signingSecret, rawBody, timestamp, signature)) {
    return { valid: false, reason: 'Invalid Slack signature' };
  }

  let payload: SlackWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SlackWebhookPayload;
  } catch {
    return { valid: false, reason: 'Invalid JSON payload' };
  }

  return { valid: true, payload };
}

/**
 * Convert a Slack webhook event to a SemanticEntity delta.
 * Returns null for non-entity event types (e.g., url_verification challenges).
 *
 * @param payload - Validated Slack webhook payload
 * @returns SemanticEntity delta or null if not an indexable event
 */
export function slackEventToEntity(payload: SlackWebhookPayload): SemanticEntity | null {
  if (payload.type !== 'event_callback' || !payload.event) return null;

  const { event } = payload;

  if (event.type === 'message' && event.channel && event.ts) {
    return {
      id: `slack:message:${event.channel}:${event.ts}`,
      type: 'message',
      label: event.text ? event.text.slice(0, 80) : 'Slack message',
      attributes: {
        channel: event.channel,
        author: event.user ?? event.username ?? null,
        text: event.text ?? null,
      },
      relationships: [
        { type: 'posted_in', targetId: `slack:channel:${event.channel}` },
      ],
      lastModified: new Date((parseFloat(event.event_ts ?? event.ts)) * 1000),
      sourceId: `slack:message:${event.channel}:${event.ts}`,
    };
  }

  return null;
}
