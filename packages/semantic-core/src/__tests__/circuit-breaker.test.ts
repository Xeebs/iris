import { describe, it, expect } from 'vitest';
import { computeNextState, computeErrorRate } from '../circuit-breaker.js';
import type { CircuitBreakerConfig } from '../circuit-breaker.js';

const config: CircuitBreakerConfig = {
  failThreshold: 5,
  errorRateThreshold: 0.5,
  windowMs: 60_000,
  cooldownMs: 30_000,
  halfOpenSuccessThreshold: 2,
};

// ─── computeNextState ─────────────────────────────────────────────────────────

describe('computeNextState', () => {
  describe('from CLOSED', () => {
    it('stays CLOSED on success', () => {
      expect(computeNextState('closed', 0, 0, null, config, true)).toBe('closed');
    });

    it('stays CLOSED on failure below threshold', () => {
      expect(computeNextState('closed', 3, 0, null, config, false)).toBe('closed');
    });

    it('transitions to OPEN on failure at threshold', () => {
      expect(computeNextState('closed', 4, 0, null, config, false)).toBe('open');
    });

    it('transitions to OPEN when fail count exactly equals threshold - 1 (reaching threshold)', () => {
      // failCount is current count BEFORE incrementing, so failCount=4 means next = 5
      expect(computeNextState('closed', 4, 0, null, config, false)).toBe('open');
    });
  });

  describe('from OPEN', () => {
    it('stays OPEN if cooldown not elapsed', () => {
      const openedAt = new Date(Date.now() - 10_000); // 10s ago, cooldown is 30s
      expect(computeNextState('open', 10, 0, openedAt, config, true)).toBe('open');
    });

    it('transitions to HALF_OPEN after cooldown', () => {
      const openedAt = new Date(Date.now() - 35_000); // 35s ago, cooldown is 30s
      expect(computeNextState('open', 10, 0, openedAt, config, true)).toBe('half_open');
    });

    it('stays OPEN if openedAt is null', () => {
      expect(computeNextState('open', 10, 0, null, config, true)).toBe('open');
    });
  });

  describe('from HALF_OPEN', () => {
    it('transitions to OPEN on failure', () => {
      expect(computeNextState('half_open', 0, 0, null, config, false)).toBe('open');
    });

    it('stays HALF_OPEN when success count below threshold', () => {
      expect(computeNextState('half_open', 0, 0, null, config, true)).toBe('half_open');
    });

    it('transitions to CLOSED when success count reaches threshold', () => {
      // successInHalfOpen = 1, threshold = 2, so 1+1 = 2 >= 2 → closed
      expect(computeNextState('half_open', 0, 1, null, config, true)).toBe('closed');
    });
  });
});

// ─── computeErrorRate ─────────────────────────────────────────────────────────

describe('computeErrorRate', () => {
  const now = new Date('2026-06-08T12:00:00Z');

  it('returns 0 for empty events', () => {
    expect(computeErrorRate([], 60_000, now)).toBe(0);
  });

  it('returns 0 for all successes', () => {
    const events = [
      { success: true, occurredAt: new Date('2026-06-08T11:59:00Z') },
      { success: true, occurredAt: new Date('2026-06-08T11:59:30Z') },
    ];
    expect(computeErrorRate(events, 60_000, now)).toBe(0);
  });

  it('returns 1.0 for all failures', () => {
    const events = [
      { success: false, occurredAt: new Date('2026-06-08T11:59:00Z') },
      { success: false, occurredAt: new Date('2026-06-08T11:59:30Z') },
    ];
    expect(computeErrorRate(events, 60_000, now)).toBe(1);
  });

  it('computes mixed error rate correctly', () => {
    const events = [
      { success: true, occurredAt: new Date('2026-06-08T11:59:00Z') },
      { success: false, occurredAt: new Date('2026-06-08T11:59:30Z') },
    ];
    expect(computeErrorRate(events, 60_000, now)).toBe(0.5);
  });

  it('ignores events outside the window', () => {
    const events = [
      { success: false, occurredAt: new Date('2026-06-08T11:58:00Z') }, // 2 min ago, outside 1min window
      { success: true, occurredAt: new Date('2026-06-08T11:59:30Z') },  // 30s ago, inside window
    ];
    expect(computeErrorRate(events, 60_000, now)).toBe(0); // only the success is in window
  });

  it('handles 3-failure-out-of-4 correctly', () => {
    const events = [
      { success: false, occurredAt: new Date('2026-06-08T11:59:00Z') },
      { success: false, occurredAt: new Date('2026-06-08T11:59:15Z') },
      { success: false, occurredAt: new Date('2026-06-08T11:59:30Z') },
      { success: true, occurredAt: new Date('2026-06-08T11:59:45Z') },
    ];
    expect(computeErrorRate(events, 60_000, now)).toBe(0.75);
  });
});
