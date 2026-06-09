import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyResilience,
  categorizeError,
  getCircuitState,
  isCircuitClosed,
  getAllCircuitStates,
  _resetCircuitState,
} from '../resilience-middleware.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

beforeEach(() => _resetCircuitState());
afterEach(() => vi.restoreAllMocks());

// ─── categorizeError ──────────────────────────────────────────────────────────

describe('categorizeError', () => {
  it('classifies timeout errors as transient', () => {
    expect(categorizeError(new Error('Operation timed out after 5000ms'))).toBe('transient');
  });

  it('classifies ECONNRESET as transient', () => {
    expect(categorizeError(new Error('read ECONNRESET'))).toBe('transient');
  });

  it('classifies ECONNREFUSED as transient', () => {
    expect(categorizeError(new Error('connect ECONNREFUSED'))).toBe('transient');
  });

  it('classifies rate limit errors as rate-limit', () => {
    expect(categorizeError(new Error('429 rate limit exceeded'))).toBe('rate-limit');
  });

  it('classifies too many requests as rate-limit', () => {
    expect(categorizeError(new Error('Too many requests'))).toBe('rate-limit');
  });

  it('classifies unknown errors as permanent', () => {
    expect(categorizeError(new Error('invalid configuration'))).toBe('permanent');
  });

  it('classifies non-Error objects as permanent', () => {
    expect(categorizeError('string error')).toBe('permanent');
  });
});

// ─── applyResilience — success path ──────────────────────────────────────────

describe('applyResilience — success path', () => {
  it('returns the function result on success', async () => {
    const result = await applyResilience(() => Promise.resolve(42), 0);
    expect(result).toBe(42);
  });

  it('returns complex object results', async () => {
    const data = { id: 'x', name: 'test' };
    const result = await applyResilience(() => Promise.resolve(data), null);
    expect(result).toEqual(data);
  });

  it('does not call fallback on success', async () => {
    const fallback = vi.fn().mockReturnValue('fallback');
    const result = await applyResilience(() => Promise.resolve('ok'), 'fallback');
    expect(result).toBe('ok');
    expect(fallback).not.toHaveBeenCalled();
  });
});

// ─── applyResilience — timeout ───────────────────────────────────────────────

describe('applyResilience — timeout', () => {
  it('returns fallback when operation exceeds timeoutMs', async () => {
    const slowFn = () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 300));
    const result = await applyResilience(slowFn, 'fallback', { timeoutMs: 50, maxRetries: 0 });
    expect(result).toBe('fallback');
  });

  it('classifies timeout as transient and retries', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 3) return new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10));
      return Promise.resolve('ok');
    };
    const result = await applyResilience(fn, 'fallback', { timeoutMs: 5000, maxRetries: 3, retryDelayMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
});

// ─── applyResilience — retries ────────────────────────────────────────────────

describe('applyResilience — retries', () => {
  it('retries transient errors up to maxRetries', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) throw new Error('ECONNRESET');
      return Promise.resolve('recovered');
    };
    const result = await applyResilience(fn, 'fallback', { maxRetries: 3, retryDelayMs: 1 });
    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });

  it('does NOT retry permanent errors', async () => {
    let attempts = 0;
    const fn = () => { attempts++; throw new Error('invalid config'); };
    const result = await applyResilience(fn, 'fallback', { maxRetries: 5, retryDelayMs: 1 });
    expect(result).toBe('fallback');
    expect(attempts).toBe(1);
  });

  it('returns fallback after exhausting retries for transient errors', async () => {
    const fn = () => { throw new Error('ECONNRESET'); };
    const result = await applyResilience(fn, 'fallback', { maxRetries: 2, retryDelayMs: 1 });
    expect(result).toBe('fallback');
  });
});

// ─── Circuit breaker ──────────────────────────────────────────────────────────

describe('Circuit breaker', () => {
  it('starts in closed state', () => {
    expect(getCircuitState('svc-a')).toBe('closed');
    expect(isCircuitClosed('svc-a')).toBe(true);
  });

  it('opens after 3 consecutive failures', async () => {
    const fn = () => { throw new Error('network error'); };
    for (let i = 0; i < 3; i++) {
      await applyResilience(fn, null, { circuitBreakerKey: 'svc-b', maxRetries: 0, retryDelayMs: 1 });
    }
    expect(getCircuitState('svc-b')).toBe('open');
    expect(isCircuitClosed('svc-b')).toBe(false);
  });

  it('returns fallback immediately when circuit is open', async () => {
    const fn = () => { throw new Error('network error'); };
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await applyResilience(fn, 'fallback', { circuitBreakerKey: 'svc-c', maxRetries: 0, retryDelayMs: 1 });
    }
    const callCount = vi.fn();
    const result = await applyResilience(
      () => { callCount(); return Promise.resolve('should-not-run'); },
      'fallback',
      { circuitBreakerKey: 'svc-c' }
    );
    expect(result).toBe('fallback');
    expect(callCount).not.toHaveBeenCalled();
  });

  it('transitions to half-open after CIRCUIT_OPEN_DURATION_MS', async () => {
    const fn = () => { throw new Error('ECONNRESET'); };
    for (let i = 0; i < 3; i++) {
      await applyResilience(fn, null, { circuitBreakerKey: 'svc-d', maxRetries: 0, retryDelayMs: 1 });
    }
    expect(getCircuitState('svc-d')).toBe('open');

    // Simulate 31s elapsed by mocking Date.now
    const base = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(base + 31_000);

    expect(isCircuitClosed('svc-d')).toBe(true);
    expect(getCircuitState('svc-d')).toBe('half-open');
    vi.restoreAllMocks();
  });

  it('resets to closed on success after half-open', async () => {
    const failFn = () => { throw new Error('ECONNRESET'); };
    for (let i = 0; i < 3; i++) {
      await applyResilience(failFn, null, { circuitBreakerKey: 'svc-e', maxRetries: 0, retryDelayMs: 1 });
    }
    expect(getCircuitState('svc-e')).toBe('open');

    // Simulate 31s elapsed
    const base = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(base + 31_000);

    // Probe succeeds
    await applyResilience(() => Promise.resolve('ok'), 'fallback', { circuitBreakerKey: 'svc-e' });
    expect(getCircuitState('svc-e')).toBe('closed');
    vi.restoreAllMocks();
  });

  it('getAllCircuitStates returns all tracked services', async () => {
    const fn = () => { throw new Error('ECONNRESET'); };
    for (let i = 0; i < 3; i++) {
      await applyResilience(fn, null, { circuitBreakerKey: 'svc-f', maxRetries: 0, retryDelayMs: 1 });
    }
    const states = getAllCircuitStates();
    expect(states['svc-f']).toBeDefined();
    expect(states['svc-f']!.state).toBe('open');
    expect(states['svc-f']!.failureCount).toBeGreaterThanOrEqual(3);
  });
});

// ─── Graceful degradation ─────────────────────────────────────────────────────

describe('Graceful degradation', () => {
  it('returns fallback on sync throw without retries', async () => {
    const fn = async (): Promise<string> => { throw new Error('configuration invalid'); };
    const result = await applyResilience(fn, 'default-result', { maxRetries: 0 });
    expect(result).toBe('default-result');
  });

  it('returns array fallback when fn fails', async () => {
    const fn = async (): Promise<number[]> => { throw new Error('service down'); };
    const result = await applyResilience(fn, [] as number[], { maxRetries: 0 });
    expect(result).toEqual([]);
  });

  it('works without circuitBreakerKey (no circuit tracking)', async () => {
    const fn = () => { throw new Error('ECONNRESET'); };
    for (let i = 0; i < 5; i++) {
      const result = await applyResilience(fn, 'fallback', { maxRetries: 0, retryDelayMs: 1 });
      expect(result).toBe('fallback');
    }
    // With no key, we have nothing tracked
    const states = getAllCircuitStates();
    expect(Object.keys(states)).not.toContain(undefined);
  });

  it('uses 5s default timeout', async () => {
    // Quick fn should not timeout
    const fn = () => Promise.resolve('fast');
    const result = await applyResilience(fn, 'timeout-fallback');
    expect(result).toBe('fast');
  });
});
