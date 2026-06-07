import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { WebhookValidator } from '../../packages/connector-sdk/src/webhook-validator.js';

const validator = new WebhookValidator();
const SECRET = 'hubspot-test-secret';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('HubSpot webhook validation', () => {
  describe('payload schema validation', () => {
    it('validates contact.propertyChange event', () => {
      const payload = [
        { subscriptionType: 'contact.propertyChange', objectId: 123, occurredAt: Date.now(), propertyName: 'email', propertyValue: 'new@example.com' },
      ];
      const result = validator.validatePayload('hubspot', payload);
      expect(result.valid).toBe(true);
    });

    it('validates company.propertyChange event', () => {
      const payload = [
        { subscriptionType: 'company.propertyChange', objectId: 456, occurredAt: Date.now() },
      ];
      expect(validator.validatePayload('hubspot', payload).valid).toBe(true);
    });

    it('validates deal.creation event', () => {
      const payload = [
        { subscriptionType: 'deal.creation', objectId: 789, occurredAt: Date.now(), propertyName: 'dealname', propertyValue: 'Enterprise Deal' },
      ];
      expect(validator.validatePayload('hubspot', payload).valid).toBe(true);
    });

    it('validates contact.deletion event (no propertyName)', () => {
      const payload = [{ subscriptionType: 'contact.deletion', objectId: 1, occurredAt: Date.now() }];
      expect(validator.validatePayload('hubspot', payload).valid).toBe(true);
    });

    it('rejects payload missing objectId', () => {
      const result = validator.validatePayload('hubspot', [{ subscriptionType: 'contact.propertyChange', occurredAt: Date.now() }]);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects payload missing subscriptionType', () => {
      const result = validator.validatePayload('hubspot', [{ objectId: 1, occurredAt: Date.now() }]);
      expect(result.valid).toBe(false);
    });
  });

  describe('HMAC signature validation', () => {
    const body = JSON.stringify([{ subscriptionType: 'contact.propertyChange', objectId: 1, occurredAt: 1000 }]);

    it('accepts request with correct HMAC signature', () => {
      const sig = sign(body);
      expect(validator.validateSignature('hubspot', body, { 'x-hubspot-signature': sig }, SECRET)).toBe(true);
    });

    it('rejects tampered body', () => {
      const sig = sign(body);
      const tamperedBody = body.replace('1000', '9999');
      expect(validator.validateSignature('hubspot', tamperedBody, { 'x-hubspot-signature': sig }, SECRET)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const sig = sign(body);
      expect(validator.validateSignature('hubspot', body, { 'x-hubspot-signature': sig }, 'wrong-secret')).toBe(false);
    });
  });

  describe('entity delta transformation', () => {
    it('maps contact events to contact entity deltas', () => {
      const payload = [{ subscriptionType: 'contact.propertyChange', objectId: 100, occurredAt: Date.now(), propertyName: 'firstname', propertyValue: 'Alice' }];
      const deltas = validator.transformToEntityDelta('hubspot', payload);
      expect(deltas[0]?.type).toBe('contact');
      expect(deltas[0]?.id).toBe('hubspot:contact:100');
    });

    it('maps company events to company entity deltas', () => {
      const payload = [{ subscriptionType: 'company.propertyChange', objectId: 200, occurredAt: Date.now() }];
      const deltas = validator.transformToEntityDelta('hubspot', payload);
      expect(deltas[0]?.type).toBe('company');
    });

    it('maps deal events to deal entity deltas', () => {
      const payload = [{ subscriptionType: 'deal.creation', objectId: 300, occurredAt: Date.now() }];
      const deltas = validator.transformToEntityDelta('hubspot', payload);
      expect(deltas[0]?.type).toBe('deal');
    });

    it('flags deletions with deleted changeType', () => {
      const payload = [{ subscriptionType: 'contact.deletion', objectId: 1, occurredAt: Date.now() }];
      const deltas = validator.transformToEntityDelta('hubspot', payload);
      expect(deltas[0]?.changeType).toBe('deleted');
    });

    it('flags creations with created changeType', () => {
      const payload = [{ subscriptionType: 'contact.creation', objectId: 1, occurredAt: Date.now() }];
      const deltas = validator.transformToEntityDelta('hubspot', payload);
      expect(deltas[0]?.changeType).toBe('created');
    });
  });
});
