import { describe, it, expect, vi } from 'vitest';
import {
  WebhookDebugger,
  computeWebhookSignature,
  validateWebhookSignature,
  comparePayloads,
} from '../webhook-debugger.js';

function makeSql(responseMap: unknown[][] = []) {
  let idx = 0;
  return vi.fn(async () => responseMap[idx++] ?? []);
}

describe('computeWebhookSignature', () => {
  it('produces consistent HMAC-SHA256 hex', () => {
    const sig1 = computeWebhookSignature('{"event":"test"}', 'secret123');
    const sig2 = computeWebhookSignature('{"event":"test"}', 'secret123');
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different sig for different payload', () => {
    const s1 = computeWebhookSignature('payload-a', 'secret');
    const s2 = computeWebhookSignature('payload-b', 'secret');
    expect(s1).not.toBe(s2);
  });

  it('produces different sig for different secret', () => {
    const s1 = computeWebhookSignature('payload', 'secret-1');
    const s2 = computeWebhookSignature('payload', 'secret-2');
    expect(s1).not.toBe(s2);
  });
});

describe('validateWebhookSignature', () => {
  it('validates correct signature', () => {
    const payload = '{"event":"contact.created"}';
    const secret = 'my-secret';
    const sig = computeWebhookSignature(payload, secret);
    const result = validateWebhookSignature(payload, secret, sig);
    expect(result.valid).toBe(true);
    expect(result.algorithm).toBe('hmac-sha256');
  });

  it('rejects tampered signature', () => {
    const result = validateWebhookSignature('payload', 'secret', 'wrongsignature');
    expect(result.valid).toBe(false);
    expect(result.expectedSignature).not.toBe(result.actualSignature);
  });

  it('rejects empty signature', () => {
    const result = validateWebhookSignature('payload', 'secret', '');
    expect(result.valid).toBe(false);
  });
});

describe('comparePayloads', () => {
  it('identifies matching fields', () => {
    const diffs = comparePayloads({ name: 'Alice', status: 'active' }, { name: 'Alice', status: 'active' });
    expect(diffs.every(d => d.matches)).toBe(true);
  });

  it('identifies differing fields', () => {
    const diffs = comparePayloads({ name: 'Alice', status: 'active' }, { name: 'Alice', status: 'inactive' });
    const statusDiff = diffs.find(d => d.field === 'status');
    expect(statusDiff?.matches).toBe(false);
    expect(statusDiff?.expected).toBe('active');
    expect(statusDiff?.actual).toBe('inactive');
  });

  it('handles fields present only in expected', () => {
    const diffs = comparePayloads({ name: 'Alice', extra: 'value' }, { name: 'Alice' });
    const extraDiff = diffs.find(d => d.field === 'extra');
    expect(extraDiff?.actual).toBeUndefined();
    expect(extraDiff?.matches).toBe(false);
  });

  it('handles fields present only in actual', () => {
    const diffs = comparePayloads({ name: 'Alice' }, { name: 'Alice', newField: 'v' });
    const newDiff = diffs.find(d => d.field === 'newField');
    expect(newDiff?.expected).toBeUndefined();
    expect(newDiff?.matches).toBe(false);
  });

  it('compares nested objects by JSON equality', () => {
    const diffs = comparePayloads({ meta: { v: 1 } }, { meta: { v: 1 } });
    expect(diffs[0]?.matches).toBe(true);
  });
});

describe('WebhookDebugger', () => {
  describe('listWebhooks', () => {
    it('returns webhook configs', async () => {
      const row = {
        webhook_id: 'wh-1', workspace_id: 'ws-1', target_url: 'https://api.example.com/hook',
        event_types: '["contact.created"]', active: true, signing_secret: 'secret',
        created_at: new Date(), last_delivery_at: null, last_delivery_success: null,
      };
      const sql = makeSql([[row]]);
      const debugger_ = new WebhookDebugger(sql as unknown as Parameters<typeof WebhookDebugger>[0]);
      const result = await debugger_.listWebhooks('ws-1');
      expect(result.isOk()).toBe(true);
      const webhooks = result._unsafeUnwrap();
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0]?.webhookId).toBe('wh-1');
    });

    it('returns error on DB failure', async () => {
      const sql = vi.fn(async () => { throw new Error('db error'); });
      const debugger_ = new WebhookDebugger(sql as unknown as Parameters<typeof WebhookDebugger>[0]);
      const result = await debugger_.listWebhooks('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getDeliveries', () => {
    it('returns delivery history', async () => {
      const row = {
        delivery_id: 'd-1', webhook_id: 'wh-1', event_type: 'contact.created',
        target_url: 'https://example.com', status_code: 200, latency_ms: 120,
        success: true, request_body: '{}', response_body: 'ok',
        error_message: null, delivered_at: new Date(), retry_count: 0,
      };
      const sql = makeSql([[row]]);
      const debugger_ = new WebhookDebugger(sql as unknown as Parameters<typeof WebhookDebugger>[0]);
      const result = await debugger_.getDeliveries('wh-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });
  });

  describe('getRetryQueue', () => {
    it('returns failed deliveries', async () => {
      const row = {
        delivery_id: 'd-fail', webhook_id: 'wh-1', event_type: 'contact.created',
        target_url: 'https://example.com', status_code: 500, latency_ms: 300,
        success: false, request_body: '{}', response_body: 'error',
        error_message: 'Server error', delivered_at: new Date(), retry_count: 1,
      };
      const sql = makeSql([[row]]);
      const debugger_ = new WebhookDebugger(sql as unknown as Parameters<typeof WebhookDebugger>[0]);
      const result = await debugger_.getRetryQueue('ws-1');
      expect(result.isOk()).toBe(true);
      const queue = result._unsafeUnwrap();
      expect(queue[0]?.success).toBe(false);
      expect(queue[0]?.retryCount).toBe(1);
    });
  });
});
