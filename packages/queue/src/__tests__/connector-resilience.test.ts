import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConnectorResilienceManager,
  computeBackoffMs,
  DEFAULT_POLICY,
} from '../connector-resilience.js';
import type { ResiliencePolicy } from '../connector-resilience.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

const CONNECTOR = 'test-connector';
const NO_DELAY = (): Promise<void> => Promise.resolve();

function makePolicy(overrides: Partial<ResiliencePolicy> = {}): ResiliencePolicy {
  return { connectorId: CONNECTOR, ...DEFAULT_POLICY, ...overrides };
}

function makeSql(rows: Record<string, unknown>[] = []) {
  return vi.fn(async () => rows) as unknown as ConstructorParameters<typeof ConnectorResilienceManager>[0];
}

describe('computeBackoffMs', () => {
  it('exponential: doubles with each attempt', () => {
    const policy = makePolicy({ backoffStrategy: 'exponential', baseDelayMs: 100, maxDelayMs: 100_000, jitterFactor: 0 });
    expect(computeBackoffMs(0, policy)).toBe(100);
    expect(computeBackoffMs(1, policy)).toBe(200);
    expect(computeBackoffMs(2, policy)).toBe(400);
  });

  it('linear: increases linearly', () => {
    const policy = makePolicy({ backoffStrategy: 'linear', baseDelayMs: 100, maxDelayMs: 100_000, jitterFactor: 0 });
    expect(computeBackoffMs(0, policy)).toBe(100);
    expect(computeBackoffMs(1, policy)).toBe(200);
    expect(computeBackoffMs(2, policy)).toBe(300);
  });

  it('fibonacci: follows fibonacci sequence', () => {
    const policy = makePolicy({ backoffStrategy: 'fibonacci', baseDelayMs: 100, maxDelayMs: 100_000, jitterFactor: 0 });
    expect(computeBackoffMs(0, policy)).toBe(100);   // fib(1)=1
    expect(computeBackoffMs(1, policy)).toBe(100);   // fib(2)=1
    expect(computeBackoffMs(2, policy)).toBe(200);   // fib(3)=2
    expect(computeBackoffMs(3, policy)).toBe(300);   // fib(4)=3
    expect(computeBackoffMs(4, policy)).toBe(500);   // fib(5)=5
  });

  it('caps at maxDelayMs', () => {
    const policy = makePolicy({ backoffStrategy: 'exponential', baseDelayMs: 1000, maxDelayMs: 500, jitterFactor: 0 });
    expect(computeBackoffMs(5, policy)).toBe(500);
  });

  it('adds jitter within bounds', () => {
    const policy = makePolicy({ backoffStrategy: 'exponential', baseDelayMs: 1000, maxDelayMs: 100_000, jitterFactor: 0.2 });
    const results = Array.from({ length: 20 }, () => computeBackoffMs(0, policy));
    // All results should be >= base and <= base * (1 + jitter)
    expect(results.every(r => r >= 1000 && r <= 1200 + 1)).toBe(true);
    // With jitter there should be some variation (probabilistic)
  });
});

describe('ConnectorResilienceManager', () => {
  let manager: ConnectorResilienceManager;

  beforeEach(() => {
    manager = new ConnectorResilienceManager(makeSql());
  });

  // ── getPolicy ────────────────────────────────────────────────────────────

  describe('getPolicy', () => {
    it('returns defaults when no DB row exists', async () => {
      const policy = await manager.getPolicy(CONNECTOR);
      expect(policy.connectorId).toBe(CONNECTOR);
      expect(policy.maxRetries).toBe(DEFAULT_POLICY.maxRetries);
      expect(policy.backoffStrategy).toBe(DEFAULT_POLICY.backoffStrategy);
    });

    it('returns stored policy when row exists', async () => {
      const sql = makeSql([{
        max_retries: 5, backoff_strategy: 'linear', base_delay_ms: 500, max_delay_ms: 30000,
        jitter_factor: 0.1, circuit_breaker_threshold: 0.4, circuit_cooldown_ms: 20000,
        timeout_ms: 8000, max_concurrent: 5,
      }]);
      const mgr = new ConnectorResilienceManager(sql);
      const policy = await mgr.getPolicy(CONNECTOR);
      expect(policy.maxRetries).toBe(5);
      expect(policy.backoffStrategy).toBe('linear');
    });

    it('falls back to defaults on DB error', async () => {
      const errSql = vi.fn().mockRejectedValue(new Error('DB down')) as unknown as ConstructorParameters<typeof ConnectorResilienceManager>[0];
      const mgr = new ConnectorResilienceManager(errSql);
      const policy = await mgr.getPolicy(CONNECTOR);
      expect(policy.maxRetries).toBe(DEFAULT_POLICY.maxRetries);
    });
  });

  // ── execute — success ────────────────────────────────────────────────────

  describe('execute — success path', () => {
    it('returns result on first successful attempt', async () => {
      const op = vi.fn().mockResolvedValue('ok');
      const result = await manager.execute(CONNECTOR, op, NO_DELAY);
      expect(result).toBe('ok');
      expect(op).toHaveBeenCalledOnce();
    });

    it('increments successCount on success', async () => {
      await manager.execute(CONNECTOR, async () => 'ok', NO_DELAY);
      expect(manager.getMetrics(CONNECTOR).successCount).toBe(1);
    });
  });

  // ── execute — retry ──────────────────────────────────────────────────────

  describe('execute — retry path', () => {
    it('retries on failure and eventually succeeds', async () => {
      let calls = 0;
      const op = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'success';
      });
      const result = await manager.execute(CONNECTOR, op, NO_DELAY);
      expect(result).toBe('success');
      expect(op).toHaveBeenCalledTimes(3);
    });

    it('increments retryCount for each retry', async () => {
      let calls = 0;
      const op = vi.fn(async () => { calls++; if (calls < 3) throw new Error('err'); return 'ok'; });
      await manager.execute(CONNECTOR, op, NO_DELAY);
      expect(manager.getMetrics(CONNECTOR).retryCount).toBe(2);
    });

    it('throws after exhausting all retries', async () => {
      const op = vi.fn().mockRejectedValue(new Error('always fails'));
      await expect(manager.execute(CONNECTOR, op, NO_DELAY)).rejects.toThrow('always fails');
      expect(op).toHaveBeenCalledTimes(DEFAULT_POLICY.maxRetries + 1);
    });

    it('calls delayFn for each retry', async () => {
      const delays: number[] = [];
      const delayFn = async (ms: number) => { delays.push(ms); };
      const op = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(manager.execute(CONNECTOR, op, delayFn)).rejects.toThrow();
      expect(delays).toHaveLength(DEFAULT_POLICY.maxRetries);
    });
  });

  // ── execute — timeout ────────────────────────────────────────────────────

  describe('execute — timeout', () => {
    it('rejects after timeoutMs with timeout error', async () => {
      const op = () => new Promise<string>(() => { /* never resolves */ });
      const sql = makeSql([{
        max_retries: 0, backoff_strategy: 'exponential', base_delay_ms: 100, max_delay_ms: 1000,
        jitter_factor: 0, circuit_breaker_threshold: 0.5, circuit_cooldown_ms: 5000,
        timeout_ms: 50, max_concurrent: 10,
      }]);
      const mgr = new ConnectorResilienceManager(sql);
      await expect(mgr.execute(CONNECTOR, op, NO_DELAY)).rejects.toThrow(/timed out/);
    });

    it('increments timeoutCount on timeout', async () => {
      const op = () => new Promise<string>(() => {});
      const sql = makeSql([{
        max_retries: 0, backoff_strategy: 'exponential', base_delay_ms: 100, max_delay_ms: 1000,
        jitter_factor: 0, circuit_breaker_threshold: 0.5, circuit_cooldown_ms: 5000,
        timeout_ms: 50, max_concurrent: 10,
      }]);
      const mgr = new ConnectorResilienceManager(sql);
      await expect(mgr.execute(CONNECTOR, op, NO_DELAY)).rejects.toThrow();
      expect(mgr.getMetrics(CONNECTOR).timeoutCount).toBeGreaterThan(0);
    });
  });

  // ── circuit breaker ──────────────────────────────────────────────────────

  describe('circuit breaker', () => {
    it('opens circuit after error rate exceeds threshold', async () => {
      // Force 5 failures to trigger circuit at 50% threshold
      for (let i = 0; i < 5; i++) {
        try {
          await manager.execute(CONNECTOR, async () => { throw new Error('fail'); }, NO_DELAY);
        } catch {
          // expected
        }
      }
      const metrics = manager.getMetrics(CONNECTOR);
      expect(metrics.circuitBreakerTrips).toBeGreaterThan(0);
    });

    it('throws immediately when circuit is open', async () => {
      // Trip circuit
      for (let i = 0; i < 6; i++) {
        try { await manager.execute(CONNECTOR, async () => { throw new Error('fail'); }, NO_DELAY); } catch {}
      }
      // Next call should fail fast without calling op
      const op = vi.fn().mockResolvedValue('ok');
      await expect(manager.execute(CONNECTOR, op, NO_DELAY)).rejects.toThrow(/circuit breaker/i);
      expect(op).not.toHaveBeenCalled();
    });

    it('resetConnector clears circuit and metrics', async () => {
      await manager.execute(CONNECTOR, async () => 'ok', NO_DELAY);
      manager.resetConnector(CONNECTOR);
      const metrics = manager.getMetrics(CONNECTOR);
      expect(metrics.successCount).toBe(0);
      expect(metrics.circuitState).toBe('closed');
    });
  });

  // ── bulkhead ─────────────────────────────────────────────────────────────

  describe('bulkhead', () => {
    it('allows up to maxConcurrent operations', async () => {
      const sql = makeSql([{
        max_retries: 0, backoff_strategy: 'exponential', base_delay_ms: 100, max_delay_ms: 1000,
        jitter_factor: 0, circuit_breaker_threshold: 0.5, circuit_cooldown_ms: 5000,
        timeout_ms: 5000, max_concurrent: 2,
      }]);
      const mgr = new ConnectorResilienceManager(sql);

      let resolved = 0;
      const slow = () => new Promise<string>(r => setTimeout(() => { resolved++; r('ok'); }, 20));

      // Launch 2 concurrent — should both succeed
      const [r1, r2] = await Promise.all([
        mgr.execute(CONNECTOR, slow, NO_DELAY),
        mgr.execute(CONNECTOR, slow, NO_DELAY),
      ]);
      expect(r1).toBe('ok');
      expect(r2).toBe('ok');
      expect(resolved).toBe(2);
    });

    it('rejects immediately when bulkhead is full', async () => {
      const sql = makeSql([{
        max_retries: 0, backoff_strategy: 'exponential', base_delay_ms: 100, max_delay_ms: 1000,
        jitter_factor: 0, circuit_breaker_threshold: 0.5, circuit_cooldown_ms: 5000,
        timeout_ms: 5000, max_concurrent: 1,
      }]);
      const mgr = new ConnectorResilienceManager(sql);

      // This op won't complete during the test
      const blocking = () => new Promise<string>(() => {});
      void mgr.execute(CONNECTOR, blocking, NO_DELAY); // starts, doesn't await

      // Second request should be rejected immediately
      await expect(mgr.execute(CONNECTOR, async () => 'ok', NO_DELAY)).rejects.toThrow(/Bulkhead/i);
    });

    it('getConcurrentCount returns current in-flight count', async () => {
      const sql = makeSql([{
        max_retries: 0, backoff_strategy: 'exponential', base_delay_ms: 100, max_delay_ms: 1000,
        jitter_factor: 0, circuit_breaker_threshold: 0.5, circuit_cooldown_ms: 5000,
        timeout_ms: 5000, max_concurrent: 5,
      }]);
      const mgr = new ConnectorResilienceManager(sql);
      expect(mgr.getConcurrentCount(CONNECTOR)).toBe(0);
    });
  });

  // ── metrics ──────────────────────────────────────────────────────────────

  describe('metrics', () => {
    it('getMetrics returns zero-valued snapshot for new connector', () => {
      const m = manager.getMetrics(CONNECTOR);
      expect(m.retryCount).toBe(0);
      expect(m.circuitBreakerTrips).toBe(0);
      expect(m.circuitState).toBe('closed');
    });

    it('getAllMetrics returns entries for all tracked connectors', async () => {
      await manager.execute('conn-a', async () => 'ok', NO_DELAY);
      await manager.execute('conn-b', async () => 'ok', NO_DELAY);
      const all = manager.getAllMetrics();
      expect(all.map(m => m.connectorId)).toContain('conn-a');
      expect(all.map(m => m.connectorId)).toContain('conn-b');
    });

    it('lastFailureAt is set after a failure', async () => {
      try {
        await manager.execute(CONNECTOR, async () => { throw new Error('boom'); }, NO_DELAY);
      } catch {}
      expect(manager.getMetrics(CONNECTOR).lastFailureAt).toBeInstanceOf(Date);
    });
  });
});
