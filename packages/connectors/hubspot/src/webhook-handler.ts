import { createHmac } from 'crypto';
import type { SemanticEntity } from '@iris/connector-sdk';

export type HubSpotWebhookEvent = {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string;
  attemptNumber: number;
  objectId: number;
  changeSource?: string;
  propertyName?: string;
  propertyValue?: string;
};

export type WebhookValidationResult =
  | { valid: true; events: HubSpotWebhookEvent[] }
  | { valid: false; reason: string };

/**
 * Validate HubSpot webhook signature using HMAC-SHA256.
 * HubSpot signs webhooks with: HMAC-SHA256(clientSecret + requestBody)
 *
 * @param clientSecret - HubSpot app client secret
 * @param rawBody      - Raw request body string
 * @param signature    - X-HubSpot-Signature header value
 */
export function validateHubSpotSignature(
  clientSecret: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', clientSecret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

/**
 * Parse and validate a HubSpot webhook payload.
 *
 * @param clientSecret - HubSpot app client secret for signature validation
 * @param rawBody      - Raw request body string
 * @param signature    - X-HubSpot-Signature header value
 */
export function parseHubSpotWebhook(
  clientSecret: string,
  rawBody: string,
  signature: string | null,
): WebhookValidationResult {
  if (!signature) {
    return { valid: false, reason: 'Missing X-HubSpot-Signature header' };
  }

  if (!validateHubSpotSignature(clientSecret, rawBody, signature)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  let events: HubSpotWebhookEvent[];
  try {
    events = JSON.parse(rawBody) as HubSpotWebhookEvent[];
    if (!Array.isArray(events)) {
      return { valid: false, reason: 'Payload must be an array of events' };
    }
  } catch {
    return { valid: false, reason: 'Invalid JSON payload' };
  }

  return { valid: true, events };
}

/**
 * Convert HubSpot webhook events to SemanticEntity deltas.
 * These are compact entities suitable for incremental index update.
 *
 * @param events - Validated HubSpot webhook events
 * @returns Array of SemanticEntity deltas (one per event)
 */
export function hubSpotEventsToEntities(events: HubSpotWebhookEvent[]): SemanticEntity[] {
  return events
    .filter((e) => e.propertyName !== undefined)
    .map((event) => {
      const entityType = deriveEntityType(event.subscriptionType);
      return {
        id: `hubspot:${entityType}:${event.objectId}`,
        type: entityType,
        label: `${entityType} ${event.objectId}`,
        attributes: event.propertyName
          ? { [event.propertyName]: event.propertyValue ?? null }
          : {},
        relationships: [],
        lastModified: new Date(event.occurredAt),
        sourceId: `hubspot:${entityType}:${event.objectId}`,
      };
    });
}

function deriveEntityType(subscriptionType: string): string {
  if (subscriptionType.includes('contact')) return 'contact';
  if (subscriptionType.includes('company')) return 'company';
  if (subscriptionType.includes('deal')) return 'deal';
  return 'object';
}
