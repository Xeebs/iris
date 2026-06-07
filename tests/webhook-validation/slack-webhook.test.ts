import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { WebhookValidator } from '../../packages/connector-sdk/src/webhook-validator.js';

const validator = new WebhookValidator();
const SECRET = 'slack-signing-secret';

function signSlack(body: string, timestamp: string): string {
  return `v0=${createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

const NOW_TS = String(Math.floor(Date.now() / 1000));

describe('Slack webhook validation', () => {
  describe('payload schema validation', () => {
    it('validates event_callback message event', () => {
      const payload = {
        type: 'event_callback',
        event: { type: 'message', channel: 'C1', user: 'U1', text: 'Hello', ts: '1.0' },
      };
      expect(validator.validatePayload('slack', payload).valid).toBe(true);
    });

    it('validates url_verification challenge', () => {
      const payload = { type: 'url_verification', challenge: 'xyz123' };
      expect(validator.validatePayload('slack', payload).valid).toBe(true);
    });

    it('validates event without optional event field (e.g., app_mention type)', () => {
      const payload = { type: 'event_callback', api_app_id: 'A123' };
      expect(validator.validatePayload('slack', payload).valid).toBe(true);
    });

    it('rejects payload without required type field', () => {
      const result = validator.validatePayload('slack', { challenge: 'test' });
      expect(result.valid).toBe(false);
    });

    it('rejects null payload', () => {
      const result = validator.validatePayload('slack', null);
      expect(result.valid).toBe(false);
    });
  });

  describe('HMAC signature validation', () => {
    const body = JSON.stringify({ type: 'event_callback', event: { type: 'message', channel: 'C1', ts: '1.0' } });

    it('accepts request with valid Slack v0 signature', () => {
      const sig = signSlack(body, NOW_TS);
      expect(validator.validateSignature('slack', body, {
        'x-slack-request-timestamp': NOW_TS,
        'x-slack-signature': sig,
      }, SECRET)).toBe(true);
    });

    it('rejects with stale timestamp (>300s)', () => {
      const stale = String(Math.floor(Date.now() / 1000) - 400);
      const sig = signSlack(body, stale);
      expect(validator.validateSignature('slack', body, {
        'x-slack-request-timestamp': stale,
        'x-slack-signature': sig,
      }, SECRET)).toBe(false);
    });

    it('rejects with tampered body', () => {
      const sig = signSlack(body, NOW_TS);
      expect(validator.validateSignature('slack', body + 'tampered', {
        'x-slack-request-timestamp': NOW_TS,
        'x-slack-signature': sig,
      }, SECRET)).toBe(false);
    });

    it('rejects missing timestamp header', () => {
      const sig = signSlack(body, NOW_TS);
      expect(validator.validateSignature('slack', body, { 'x-slack-signature': sig }, SECRET)).toBe(false);
    });

    it('rejects non-numeric timestamp', () => {
      expect(validator.validateSignature('slack', body, {
        'x-slack-request-timestamp': 'not-a-number',
        'x-slack-signature': 'v0=abc',
      }, SECRET)).toBe(false);
    });
  });

  describe('entity delta transformation', () => {
    const messagePayload = {
      type: 'event_callback',
      event: { type: 'message', channel: 'C-GENERAL', user: 'U-ALICE', text: 'Project update ready', ts: '1717000000.000100' },
    };

    it('transforms message event to message delta', () => {
      const deltas = validator.transformToEntityDelta('slack', messagePayload);
      expect(deltas).toHaveLength(1);
      expect(deltas[0]?.type).toBe('message');
      expect(deltas[0]?.id).toBe('slack:message:C-GENERAL:1717000000.000100');
    });

    it('includes channel, author, and text in attributes', () => {
      const deltas = validator.transformToEntityDelta('slack', messagePayload);
      expect(deltas[0]?.attributes['channel']).toBe('C-GENERAL');
      expect(deltas[0]?.attributes['author']).toBe('U-ALICE');
      expect(deltas[0]?.attributes['text']).toBe('Project update ready');
    });

    it('sets changeType=created for message events', () => {
      const deltas = validator.transformToEntityDelta('slack', messagePayload);
      expect(deltas[0]?.changeType).toBe('created');
    });

    it('returns empty for url_verification (not an entity event)', () => {
      const deltas = validator.transformToEntityDelta('slack', { type: 'url_verification', challenge: 'abc' });
      expect(deltas).toHaveLength(0);
    });

    it('returns empty for event_callback without event field', () => {
      const deltas = validator.transformToEntityDelta('slack', { type: 'event_callback' });
      expect(deltas).toHaveLength(0);
    });
  });
});
