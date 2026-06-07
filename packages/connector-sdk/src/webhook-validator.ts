import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { SemanticEntity } from './base-connector.js';

export type SupportedVendor = 'hubspot' | 'slack';

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  vendor: SupportedVendor;
};

export type EntityDelta = {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
  changeType: 'created' | 'updated' | 'deleted';
};

// ─── HubSpot schemas ──────────────────────────────────────────────────────────

const hubSpotEventSchema = z.object({
  subscriptionType: z.string(),
  objectId: z.number(),
  occurredAt: z.number(),
  propertyName: z.string().optional(),
  propertyValue: z.string().nullable().optional(),
  changeSource: z.string().optional(),
});

const hubSpotPayloadSchema = z.array(hubSpotEventSchema).min(1);

// ─── Slack schemas ────────────────────────────────────────────────────────────

const slackEventSchema = z.object({
  type: z.string(),
  channel: z.string().optional(),
  user: z.string().optional(),
  text: z.string().optional(),
  ts: z.string().optional(),
  event_ts: z.string().optional(),
});

const slackPayloadSchema = z.object({
  type: z.string(),
  token: z.string().optional(),
  team_id: z.string().optional(),
  api_app_id: z.string().optional(),
  challenge: z.string().optional(),
  event: slackEventSchema.optional(),
  event_id: z.string().optional(),
  event_time: z.number().optional(),
});

/**
 * Reusable webhook validation for vendor payloads.
 * Validates schema, HMAC signatures, and transforms events to entity deltas.
 */
export class WebhookValidator {
  /**
   * Validate that a raw payload conforms to the expected vendor schema.
   *
   * @param vendor  - The webhook source (hubspot | slack)
   * @param payload - Parsed JSON payload from the webhook request body
   * @returns ValidationResult with errors list; valid=true means schema passes
   */
  validatePayload(vendor: SupportedVendor, payload: unknown): ValidationResult {
    const errors: string[] = [];
    let valid = true;

    switch (vendor) {
      case 'hubspot': {
        const result = hubSpotPayloadSchema.safeParse(payload);
        if (!result.success) {
          valid = false;
          errors.push(...result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
        }
        break;
      }
      case 'slack': {
        const result = slackPayloadSchema.safeParse(payload);
        if (!result.success) {
          valid = false;
          errors.push(...result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
        }
        break;
      }
      default: {
        valid = false;
        errors.push(`Unsupported vendor: ${vendor as string}`);
      }
    }

    return { valid, errors, vendor };
  }

  /**
   * Validate the HMAC signature for a webhook request.
   *
   * @param vendor   - The webhook source
   * @param rawBody  - Raw request body string (before JSON parsing)
   * @param headers  - Request headers (lowercase keys)
   * @param secret   - Shared secret for HMAC computation
   * @returns true if signature is valid, false otherwise
   */
  validateSignature(
    vendor: SupportedVendor,
    rawBody: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    if (!secret) return false;

    switch (vendor) {
      case 'hubspot':
        return this.validateHubSpotSignature(secret, rawBody, headers['x-hubspot-signature'] ?? '');
      case 'slack':
        return this.validateSlackSignature(
          secret,
          rawBody,
          headers['x-slack-request-timestamp'] ?? '',
          headers['x-slack-signature'] ?? '',
        );
      default:
        return false;
    }
  }

  /**
   * Transform a parsed vendor payload into entity deltas for indexing.
   *
   * @param vendor  - The webhook source
   * @param payload - Parsed JSON payload
   * @returns Array of entity deltas (may be empty for unsupported event types)
   */
  transformToEntityDelta(vendor: SupportedVendor, payload: unknown): EntityDelta[] {
    switch (vendor) {
      case 'hubspot':
        return this.transformHubSpotPayload(payload);
      case 'slack':
        return this.transformSlackPayload(payload);
      default:
        return [];
    }
  }

  /**
   * Convert a validated entity delta back to a SemanticEntity shape for indexing.
   *
   * @param delta      - Entity delta from transformToEntityDelta
   * @param workspaceId - Workspace for the entity (not stored on delta itself)
   * @returns Partial SemanticEntity ready for semantic indexer
   */
  deltaToSemanticEntity(delta: EntityDelta): Omit<SemanticEntity, 'lastModified'> & { lastModified: Date } {
    return {
      id: delta.id,
      type: delta.type,
      label: delta.label,
      attributes: delta.attributes as SemanticEntity['attributes'],
      relationships: [],
      lastModified: new Date(),
      sourceId: delta.id,
    };
  }

  private validateHubSpotSignature(clientSecret: string, rawBody: string, signature: string): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', clientSecret).update(rawBody).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }

  private validateSlackSignature(
    signingSecret: string,
    rawBody: string,
    timestamp: string,
    signature: string,
  ): boolean {
    if (!timestamp || !signature) return false;
    const reqTime = parseInt(timestamp, 10);
    if (isNaN(reqTime) || Math.abs(Date.now() / 1000 - reqTime) > 300) return false;

    const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  private transformHubSpotPayload(payload: unknown): EntityDelta[] {
    const result = hubSpotPayloadSchema.safeParse(payload);
    if (!result.success) return [];

    return result.data.map((event) => {
      const type = event.subscriptionType.includes('contact')
        ? 'contact'
        : event.subscriptionType.includes('company')
          ? 'company'
          : event.subscriptionType.includes('deal')
            ? 'deal'
            : 'object';

      const changeType: EntityDelta['changeType'] = event.subscriptionType.includes('deletion')
        ? 'deleted'
        : event.subscriptionType.includes('creation')
          ? 'created'
          : 'updated';

      return {
        id: `hubspot:${type}:${event.objectId}`,
        type,
        label: `${type} ${event.objectId}`,
        attributes: {
          ...(event.propertyName ? { [event.propertyName]: event.propertyValue ?? null } : {}),
          occurredAt: event.occurredAt,
        },
        changeType,
      };
    });
  }

  private transformSlackPayload(payload: unknown): EntityDelta[] {
    const result = slackPayloadSchema.safeParse(payload);
    if (!result.success || !result.data.event) return [];

    const { event, type } = result.data;
    if (type !== 'event_callback') return [];

    if (event.type === 'message' && event.channel && event.ts) {
      return [
        {
          id: `slack:message:${event.channel}:${event.ts}`,
          type: 'message',
          label: event.text ? event.text.slice(0, 80) : 'Slack message',
          attributes: {
            channel: event.channel,
            author: event.user ?? null,
            text: event.text ?? null,
          },
          changeType: 'created',
        },
      ];
    }

    if (event.type === 'member_joined_channel' && event.user && event.channel) {
      return [
        {
          id: `slack:user:${event.user}`,
          type: 'user',
          label: `User ${event.user}`,
          attributes: { userId: event.user, channel: event.channel },
          changeType: 'updated',
        },
      ];
    }

    return [];
  }
}
