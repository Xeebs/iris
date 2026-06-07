import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { WebhookValidator } from '../webhook-validator.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const validator = new WebhookValidator();

// ─── HubSpot fixture ──────────────────────────────────────────────────────────

const hubSpotEventFixture = [
  {
    subscriptionType: 'contact.propertyChange',
    objectId: 12345,
    occurredAt: 1717000000000,
    propertyName: 'lifecyclestage',
    propertyValue: 'customer',
    changeSource: 'CRM',
  },
];

const hubSpotDeletionFixture = [
  {
    subscriptionType: 'contact.deletion',
    objectId: 99,
    occurredAt: 1717000000000,
  },
];

const hubSpotCreationFixture = [
  {
    subscriptionType: 'deal.creation',
    objectId: 42,
    occurredAt: 1717000000000,
    propertyName: 'dealname',
    propertyValue: 'New Deal',
  },
];

// ─── Slack fixtures ───────────────────────────────────────────────────────────

const slackMessageFixture = {
  type: 'event_callback',
  team_id: 'T123',
  api_app_id: 'A123',
  event: {
    type: 'message',
    channel: 'C123',
    user: 'U456',
    text: 'Hello world',
    ts: '1717000000.000100',
    event_ts: '1717000000.000100',
  },
  event_id: 'Ev123',
  event_time: 1717000000,
};

const slackChallengeFixture = {
  type: 'url_verification',
  challenge: 'abc123',
};

// ─── validatePayload ──────────────────────────────────────────────────────────

describe('WebhookValidator.validatePayload', () => {
  describe('HubSpot', () => {
    it('accepts valid HubSpot event array', () => {
      const result = validator.validatePayload('hubspot', hubSpotEventFixture);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects non-array HubSpot payload', () => {
      const result = validator.validatePayload('hubspot', { subscriptionType: 'contact.propertyChange' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects HubSpot event without required objectId', () => {
      const result = validator.validatePayload('hubspot', [{ subscriptionType: 'contact.change', occurredAt: 123 }]);
      expect(result.valid).toBe(false);
    });

    it('rejects empty array', () => {
      const result = validator.validatePayload('hubspot', []);
      expect(result.valid).toBe(false);
    });

    it('accepts deletion event without propertyName', () => {
      const result = validator.validatePayload('hubspot', hubSpotDeletionFixture);
      expect(result.valid).toBe(true);
    });
  });

  describe('Slack', () => {
    it('accepts valid Slack event_callback', () => {
      const result = validator.validatePayload('slack', slackMessageFixture);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts Slack url_verification challenge', () => {
      const result = validator.validatePayload('slack', slackChallengeFixture);
      expect(result.valid).toBe(true);
    });

    it('rejects Slack payload without type field', () => {
      const result = validator.validatePayload('slack', { event: {} });
      expect(result.valid).toBe(false);
    });

    it('returns correct vendor in result', () => {
      const result = validator.validatePayload('slack', slackMessageFixture);
      expect(result.vendor).toBe('slack');
    });
  });
});

// ─── validateSignature ────────────────────────────────────────────────────────

describe('WebhookValidator.validateSignature', () => {
  describe('HubSpot HMAC', () => {
    const secret = 'test-hubspot-secret';
    const rawBody = JSON.stringify(hubSpotEventFixture);
    const validSig = createHmac('sha256', secret).update(rawBody).digest('hex');

    it('accepts valid HubSpot HMAC signature', () => {
      const result = validator.validateSignature('hubspot', rawBody, { 'x-hubspot-signature': validSig }, secret);
      expect(result).toBe(true);
    });

    it('rejects invalid HubSpot signature', () => {
      const result = validator.validateSignature('hubspot', rawBody, { 'x-hubspot-signature': 'invalid' }, secret);
      expect(result).toBe(false);
    });

    it('rejects missing HubSpot signature header', () => {
      const result = validator.validateSignature('hubspot', rawBody, {}, secret);
      expect(result).toBe(false);
    });

    it('rejects empty secret', () => {
      const result = validator.validateSignature('hubspot', rawBody, { 'x-hubspot-signature': validSig }, '');
      expect(result).toBe(false);
    });
  });

  describe('Slack HMAC', () => {
    const secret = 'test-slack-secret';
    const rawBody = JSON.stringify(slackMessageFixture);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;

    it('accepts valid Slack v0 signature', () => {
      const result = validator.validateSignature('slack', rawBody, {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': expected,
      }, secret);
      expect(result).toBe(true);
    });

    it('rejects stale Slack timestamp (>5 min old)', () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
      const staleSig = `v0=${createHmac('sha256', secret).update(`v0:${oldTimestamp}:${rawBody}`).digest('hex')}`;
      const result = validator.validateSignature('slack', rawBody, {
        'x-slack-request-timestamp': oldTimestamp,
        'x-slack-signature': staleSig,
      }, secret);
      expect(result).toBe(false);
    });

    it('rejects Slack payload with wrong signature', () => {
      const result = validator.validateSignature('slack', rawBody, {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=wrongsig',
      }, secret);
      expect(result).toBe(false);
    });

    it('rejects missing Slack timestamp', () => {
      const result = validator.validateSignature('slack', rawBody, {
        'x-slack-signature': expected,
      }, secret);
      expect(result).toBe(false);
    });
  });
});

// ─── transformToEntityDelta ───────────────────────────────────────────────────

describe('WebhookValidator.transformToEntityDelta', () => {
  describe('HubSpot', () => {
    it('transforms property change event to contact delta', () => {
      const deltas = validator.transformToEntityDelta('hubspot', hubSpotEventFixture);
      expect(deltas).toHaveLength(1);
      expect(deltas[0]).toMatchObject({
        id: 'hubspot:contact:12345',
        type: 'contact',
        changeType: 'updated',
      });
    });

    it('detects deletion change type', () => {
      const deltas = validator.transformToEntityDelta('hubspot', hubSpotDeletionFixture);
      expect(deltas[0]?.changeType).toBe('deleted');
    });

    it('detects creation change type for deal', () => {
      const deltas = validator.transformToEntityDelta('hubspot', hubSpotCreationFixture);
      expect(deltas[0]?.changeType).toBe('created');
      expect(deltas[0]?.type).toBe('deal');
      expect(deltas[0]?.id).toBe('hubspot:deal:42');
    });

    it('includes propertyName in attributes', () => {
      const deltas = validator.transformToEntityDelta('hubspot', hubSpotEventFixture);
      expect(deltas[0]?.attributes['lifecyclestage']).toBe('customer');
    });

    it('returns empty for invalid payload', () => {
      const deltas = validator.transformToEntityDelta('hubspot', { invalid: true });
      expect(deltas).toHaveLength(0);
    });

    it('transforms multiple events in array', () => {
      const payload = [
        ...hubSpotEventFixture,
        { subscriptionType: 'company.propertyChange', objectId: 99, occurredAt: 1717000000000 },
      ];
      const deltas = validator.transformToEntityDelta('hubspot', payload);
      expect(deltas).toHaveLength(2);
      expect(deltas[1]?.type).toBe('company');
    });
  });

  describe('Slack', () => {
    it('transforms message event to message delta', () => {
      const deltas = validator.transformToEntityDelta('slack', slackMessageFixture);
      expect(deltas).toHaveLength(1);
      expect(deltas[0]).toMatchObject({
        id: 'slack:message:C123:1717000000.000100',
        type: 'message',
        changeType: 'created',
      });
    });

    it('includes message text in attributes', () => {
      const deltas = validator.transformToEntityDelta('slack', slackMessageFixture);
      expect(deltas[0]?.attributes['text']).toBe('Hello world');
      expect(deltas[0]?.attributes['author']).toBe('U456');
    });

    it('truncates long message text to 80 chars', () => {
      const longText = 'A'.repeat(100);
      const payload = { ...slackMessageFixture, event: { ...slackMessageFixture.event, text: longText } };
      const deltas = validator.transformToEntityDelta('slack', payload);
      expect(deltas[0]?.label.length).toBeLessThanOrEqual(80);
    });

    it('returns empty for url_verification type', () => {
      const deltas = validator.transformToEntityDelta('slack', slackChallengeFixture);
      expect(deltas).toHaveLength(0);
    });

    it('returns empty for non-message event without channel', () => {
      const payload = { ...slackMessageFixture, event: { type: 'reaction_added' } };
      const deltas = validator.transformToEntityDelta('slack', payload);
      expect(deltas).toHaveLength(0);
    });

    it('transforms member_joined_channel to user delta', () => {
      const payload = {
        ...slackMessageFixture,
        event: { type: 'member_joined_channel', user: 'U789', channel: 'C123' },
      };
      const deltas = validator.transformToEntityDelta('slack', payload);
      expect(deltas[0]?.type).toBe('user');
      expect(deltas[0]?.changeType).toBe('updated');
    });
  });
});

// ─── deltaToSemanticEntity ────────────────────────────────────────────────────

describe('WebhookValidator.deltaToSemanticEntity', () => {
  it('converts delta to SemanticEntity shape', () => {
    const delta = validator.transformToEntityDelta('hubspot', hubSpotEventFixture)[0]!;
    const entity = validator.deltaToSemanticEntity(delta);
    expect(entity.id).toBe(delta.id);
    expect(entity.type).toBe(delta.type);
    expect(entity.relationships).toEqual([]);
    expect(entity.lastModified).toBeInstanceOf(Date);
  });
});
