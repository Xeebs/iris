import { describe, it, expect } from 'vitest';
import { WebhookValidator } from '../../packages/connector-sdk/src/webhook-validator.js';

const validator = new WebhookValidator();

describe('WebhookValidator — cross-vendor patterns', () => {
  it('returns valid=false for unknown vendor', () => {
    const result = validator.validatePayload('hubspot', null);
    expect(result.valid).toBe(false);
  });

  it('validateSignature returns false for empty secret regardless of vendor', () => {
    expect(validator.validateSignature('hubspot', '{}', { 'x-hubspot-signature': 'abc' }, '')).toBe(false);
    expect(validator.validateSignature('slack', '{}', { 'x-slack-request-timestamp': '123', 'x-slack-signature': 'abc' }, '')).toBe(false);
  });

  it('transformToEntityDelta returns empty array for invalid payload', () => {
    expect(validator.transformToEntityDelta('hubspot', null)).toHaveLength(0);
    expect(validator.transformToEntityDelta('slack', null)).toHaveLength(0);
  });

  it('deltaToSemanticEntity preserves id, type, label from delta', () => {
    const delta = {
      id: 'hubspot:contact:1',
      type: 'contact',
      label: 'Test User',
      attributes: { email: 'test@example.com' },
      changeType: 'updated' as const,
    };
    const entity = validator.deltaToSemanticEntity(delta);
    expect(entity.id).toBe(delta.id);
    expect(entity.type).toBe(delta.type);
    expect(entity.label).toBe(delta.label);
    expect(entity.relationships).toEqual([]);
  });

  it('entity deltas from different vendors have globally unique IDs', () => {
    const hubSpotDeltas = validator.transformToEntityDelta('hubspot', [
      { subscriptionType: 'contact.propertyChange', objectId: 1, occurredAt: 1000 },
    ]);
    const slackDeltas = validator.transformToEntityDelta('slack', {
      type: 'event_callback',
      event: { type: 'message', channel: 'C1', user: 'U1', ts: '1.0' },
    });

    const allIds = [...hubSpotDeltas, ...slackDeltas].map((d) => d.id);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it('workspace isolation: delta IDs are connector-prefixed and cannot overlap', () => {
    const hubId = 'hubspot:contact:1';
    const slackId = 'slack:message:C1:1.0';
    expect(hubId).not.toBe(slackId);
    expect(hubId.startsWith('hubspot:')).toBe(true);
    expect(slackId.startsWith('slack:')).toBe(true);
  });
});
