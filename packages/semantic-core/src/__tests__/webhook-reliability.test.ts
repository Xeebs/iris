import { describe, it, expect } from 'vitest';
import {
  nextRetryDelay,
  classifyError,
  analyzeDlqPatterns,
  DEFAULT_RETRY_POLICY,
} from '../webhook-reliability.js';
import type { DlqEvent } from '../webhook-reliability.js';

function makeDlqEvent(overrides: Partial<DlqEvent> = {}): DlqEvent {
  return {
    id: 'ev-1',
    workspaceId: 'ws1',
    endpoint: 'https://hooks.example.com/iris',
    eventType: 'entity.updated',
    payload: { id: '1' },
    finalError: 'ECONNREFUSED',
    attempts: [],
    failedAt: new Date(),
    replayedAt: null,
    replayedBy: null,
    ...overrides,
  };
}

describe('nextRetryDelay', () => {
  it('returns the backoff for the given attempt', () => {
    expect(nextRetryDelay(0)).toBe(1000);
    expect(nextRetryDelay(1)).toBe(4000);
    expect(nextRetryDelay(2)).toBe(16000);
    expect(nextRetryDelay(3)).toBe(64000);
    expect(nextRetryDelay(4)).toBe(256000);
  });

  it('returns null when max attempts exceeded', () => {
    expect(nextRetryDelay(5, DEFAULT_RETRY_POLICY)).toBeNull();
    expect(nextRetryDelay(10, DEFAULT_RETRY_POLICY)).toBeNull();
  });

  it('uses last backoff value when attempt exceeds backoff array', () => {
    const policy = { maxAttempts: 10, backoffMs: [1000, 2000] };
    expect(nextRetryDelay(5, policy)).toBe(2000);
  });
});

describe('classifyError', () => {
  it('classifies 401 as auth_failure', () => {
    expect(classifyError('Unauthorized', 401)).toBe('auth_failure');
  });

  it('classifies 403 as auth_failure', () => {
    expect(classifyError('Forbidden', 403)).toBe('auth_failure');
  });

  it('classifies timeout errors', () => {
    expect(classifyError('ETIMEDOUT', null)).toBe('timeout');
    expect(classifyError('timed out', 504)).toBe('timeout');
  });

  it('classifies connection errors', () => {
    expect(classifyError('ECONNREFUSED', null)).toBe('endpoint_unreachable');
    expect(classifyError('network error', 503)).toBe('endpoint_unreachable');
  });

  it('classifies payload errors', () => {
    expect(classifyError('invalid schema', 422)).toBe('payload_rejected');
    expect(classifyError('malformed JSON', 400)).toBe('payload_rejected');
  });

  it('classifies unknown errors', () => {
    expect(classifyError('something unexpected', 500)).toBe('unknown');
  });
});

describe('analyzeDlqPatterns', () => {
  it('returns empty for no events', () => {
    expect(analyzeDlqPatterns([])).toEqual([]);
  });

  it('groups events by pattern', () => {
    const events = [
      makeDlqEvent({ finalError: 'ECONNREFUSED', endpoint: 'https://ep1.com' }),
      makeDlqEvent({ id: 'ev-2', finalError: 'ECONNREFUSED', endpoint: 'https://ep2.com' }),
      makeDlqEvent({ id: 'ev-3', finalError: 'ETIMEDOUT' }),
    ];
    const patterns = analyzeDlqPatterns(events);
    const unreachable = patterns.find((p) => p.pattern === 'endpoint_unreachable');
    const timeout = patterns.find((p) => p.pattern === 'timeout');
    expect(unreachable!.count).toBe(2);
    expect(unreachable!.affectedEndpoints).toHaveLength(2);
    expect(timeout!.count).toBe(1);
  });

  it('includes suggestions for each pattern', () => {
    const events = [makeDlqEvent({ finalError: 'Unauthorized', attempts: [{ attemptNumber: 1, occurredAt: new Date(), httpStatus: 401, errorMessage: null, durationMs: null }] })];
    const patterns = analyzeDlqPatterns(events);
    expect(patterns[0]!.suggestion).toBeTruthy();
  });
});
