import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  validateHubSpotSignature,
  parseHubSpotWebhook,
  hubSpotEventsToEntities,
} from '../webhook-handler.js';
import type { HubSpotWebhookEvent } from '../webhook-handler.js';

const CLIENT_SECRET = 'test-client-secret-abc123';

function makeSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const SAMPLE_EVENTS: HubSpotWebhookEvent[] = [
  {
    eventId: 1001,
    subscriptionId: 200,
    portalId: 12345,
    appId: 9999,
    occurredAt: 1748851200000,
    subscriptionType: 'contact.propertyChange',
    attemptNumber: 0,
    objectId: 55001,
    propertyName: 'lifecyclestage',
    propertyValue: 'customer',
  },
  {
    eventId: 1002,
    subscriptionId: 201,
    portalId: 12345,
    appId: 9999,
    occurredAt: 1748851260000,
    subscriptionType: 'deal.propertyChange',
    attemptNumber: 0,
    objectId: 66001,
    propertyName: 'dealstage',
    propertyValue: 'closedwon',
  },
];

describe('validateHubSpotSignature', () => {
  it('returns true for a valid HMAC-SHA256 signature', () => {
    const body = JSON.stringify(SAMPLE_EVENTS);
    const sig = makeSignature(CLIENT_SECRET, body);
    expect(validateHubSpotSignature(CLIENT_SECRET, body, sig)).toBe(true);
  });

  it('returns false for an incorrect signature', () => {
    const body = JSON.stringify(SAMPLE_EVENTS);
    expect(validateHubSpotSignature(CLIENT_SECRET, body, 'bad-signature')).toBe(false);
  });

  it('returns false when body is tampered', () => {
    const originalBody = JSON.stringify(SAMPLE_EVENTS);
    const sig = makeSignature(CLIENT_SECRET, originalBody);
    const tamperedBody = originalBody + ' ';
    expect(validateHubSpotSignature(CLIENT_SECRET, tamperedBody, sig)).toBe(false);
  });
});

describe('parseHubSpotWebhook', () => {
  it('returns valid result with events for correct signature', () => {
    const body = JSON.stringify(SAMPLE_EVENTS);
    const sig = makeSignature(CLIENT_SECRET, body);

    const result = parseHubSpotWebhook(CLIENT_SECRET, body, sig);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.events).toHaveLength(2);
      expect(result.events[0]!.objectId).toBe(55001);
    }
  });

  it('returns invalid when signature header is null', () => {
    const body = JSON.stringify(SAMPLE_EVENTS);
    const result = parseHubSpotWebhook(CLIENT_SECRET, body, null);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('Missing');
    }
  });

  it('returns invalid when signature is wrong', () => {
    const body = JSON.stringify(SAMPLE_EVENTS);
    const result = parseHubSpotWebhook(CLIENT_SECRET, body, 'wrong-sig');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('Invalid signature');
    }
  });

  it('returns invalid for non-array JSON payload', () => {
    const body = '{"not": "an array"}';
    const sig = makeSignature(CLIENT_SECRET, body);
    const result = parseHubSpotWebhook(CLIENT_SECRET, body, sig);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('array');
    }
  });

  it('returns invalid for malformed JSON', () => {
    const body = 'not-json{{{';
    const sig = makeSignature(CLIENT_SECRET, body);
    const result = parseHubSpotWebhook(CLIENT_SECRET, body, sig);

    expect(result.valid).toBe(false);
  });
});

describe('hubSpotEventsToEntities', () => {
  it('converts contact events to SemanticEntity objects', () => {
    const entities = hubSpotEventsToEntities(SAMPLE_EVENTS);

    expect(entities).toHaveLength(2);
    expect(entities[0]!.id).toBe('hubspot:contact:55001');
    expect(entities[0]!.type).toBe('contact');
    expect(entities[0]!.attributes['lifecyclestage']).toBe('customer');
  });

  it('converts deal events with correct type', () => {
    const entities = hubSpotEventsToEntities(SAMPLE_EVENTS);

    expect(entities[1]!.id).toBe('hubspot:deal:66001');
    expect(entities[1]!.type).toBe('deal');
    expect(entities[1]!.attributes['dealstage']).toBe('closedwon');
  });

  it('sets lastModified from occurredAt timestamp', () => {
    const entities = hubSpotEventsToEntities(SAMPLE_EVENTS);

    expect(entities[0]!.lastModified.getTime()).toBe(1748851200000);
  });

  it('filters out events without a propertyName', () => {
    const eventsWithMissing: HubSpotWebhookEvent[] = [
      { ...SAMPLE_EVENTS[0]!, propertyName: undefined },
      SAMPLE_EVENTS[1]!,
    ];
    const entities = hubSpotEventsToEntities(eventsWithMissing);

    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe('deal');
  });

  it('handles unknown subscription type as "object"', () => {
    const unknownEvent: HubSpotWebhookEvent = {
      ...SAMPLE_EVENTS[0]!,
      subscriptionType: 'ticket.propertyChange',
      propertyName: 'subject',
    };
    const entities = hubSpotEventsToEntities([unknownEvent]);
    expect(entities[0]!.type).toBe('object');
  });
});
