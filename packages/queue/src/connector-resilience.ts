import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'connector-resilience' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type BackoffStrategy = 'exponential' | 'linear' | 'fibonacci';

export type ResiliencePolicy = {
  connectorId: string;
  maxRetries: number;
  backoffStrategy: BackoffStrategy;
  /** Base delay in ms for backoff calculation. Default: 1000 */
  baseDelayMs: number;
  /** Max backoff delay cap in ms. Default: 60_000 */
  maxDelayMs: number;
  /** Jitter factor 0–1 applied to backoff. Default: 0.2 */
  jitterFactor: number;
  /** Circuit breaker: error rate threshold 0–1. Default: 0.5 */
  circuitBreakerThreshold: number;
  /** Circuit open duration in ms before entering half-open. Default: 30_000 */
  circuitCooldownMs: number;
  /** Per-operation timeout in ms. Default: 10_000 */
  timeoutMs: number;
  /** Max concurrent operations (bulkhead). Default: 10 */
  maxConcurrent: number;
};

export type CircuitState = 'closed' | 'open' | 'half_open';

export type ResilienceMetrics = {
  connectorId: string;
  retryCount: number;
  timeoutCount: number;
  circuitBreakerTrips: number;
  successCount: number;
  failureCount: number;
  lastFailureAt: Date | null;
  circuitState: CircuitState;
};

export const DEFAULT_POLICY: Omit<ResiliencePolicy, 'connectorId'> = {
  maxRetries: 3,
  backoffStrategy: 'exponential',
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterFactor: 0.2,
  circuitBreakerThreshold: 0.5,
  circuitCooldownMs: 30_000,
  timeoutMs: 10_000,
  maxConcurrent: 10,
};

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Backoff ──────────────────────────────────────────────────────────────────

function fibSequence(n: number): number {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

export function computeBackoffMs(attempt: number, policy: ResiliencePolicy): number {
  let base: number;
  switch (policy.backoffStrategy) {
    case 'linear':
      base = policy.baseDelayMs * (attempt + 1);
      break;
    case 'fibonacci':
      base = policy.baseDelayMs * fibSequence(attempt + 1);
      break;
    case 'exponential':
    default:
      base = policy.baseDelayMs * 2 ** attempt;
      break;
  }
  const capped = Math.min(base, policy.maxDelayMs);
  const jitter = capped * policy.jitterFactor * Math.random();
  return Math.round(capped + jitter);
}

// ─── ConnectorResilienceManager ───────────────────────────────────────────────

/**
 * Manages configurable retry/timeout/circuit-breaker/bulkhead policies per connector.
 * Policies are persisted in Postgres; metrics are tracked in-memory (process-local).
 */
export class ConnectorResilienceManager {
  private readonly metrics: Map<string, ResilienceMetrics> = new Map();
  private readonly semaphores: Map<string, number> = new Map();
  private readonly circuitOpenAt: Map<string, number> = new Map();

  constructor(private readonly sql: SqlFn) {}

  // ── Policy persistence ────────────────────────────────────────────────────

  /**
   * Persist a resilience policy for a connector.
   *
   * @param policy - Policy configuration
   */
  async setPolicy(policy: ResiliencePolicy): Promise<void> {
    await this.sql`
      INSERT INTO connector_resilience_config (
        connector_id, max_retries, backoff_strategy, base_delay_ms, max_delay_ms,
        jitter_factor, circuit_breaker_threshold, circuit_cooldown_ms, timeout_ms, max_concurrent
      )
      VALUES (
        ${policy.connectorId}, ${policy.maxRetries}, ${policy.backoffStrategy},
        ${policy.baseDelayMs}, ${policy.maxDelayMs}, ${policy.jitterFactor},
        ${policy.circuitBreakerThreshold}, ${policy.circuitCooldownMs},
        ${policy.timeoutMs}, ${policy.maxConcurrent}
      )
      ON CONFLICT (connector_id) DO UPDATE SET
        max_retries = EXCLUDED.max_retries,
        backoff_strategy = EXCLUDED.backoff_strategy,
        base_delay_ms = EXCLUDED.base_delay_ms,
        max_delay_ms = EXCLUDED.max_delay_ms,
        jitter_factor = EXCLUDED.jitter_factor,
        circuit_breaker_threshold = EXCLUDED.circuit_breaker_threshold,
        circuit_cooldown_ms = EXCLUDED.circuit_cooldown_ms,
        timeout_ms = EXCLUDED.timeout_ms,
        max_concurrent = EXCLUDED.max_concurrent,
        updated_at = now()
    `;
  }

  /**
   * Load the resilience policy for a connector, falling back to defaults.
   *
   * @param connectorId - Connector identifier
   * @returns Resolved policy
   */
  async getPolicy(connectorId: string): Promise<ResiliencePolicy> {
    try {
      const rows = await this.sql`
        SELECT * FROM connector_resilience_config WHERE connector_id = ${connectorId}
      ` as Record<string, unknown>[];

      if (rows.length === 0) return { connectorId, ...DEFAULT_POLICY };

      const r = rows[0]!;
      return {
        connectorId,
        maxRetries: r['max_retries'] as number,
        backoffStrategy: r['backoff_strategy'] as BackoffStrategy,
        baseDelayMs: r['base_delay_ms'] as number,
        maxDelayMs: r['max_delay_ms'] as number,
        jitterFactor: r['jitter_factor'] as number,
        circuitBreakerThreshold: r['circuit_breaker_threshold'] as number,
        circuitCooldownMs: r['circuit_cooldown_ms'] as number,
        timeoutMs: r['timeout_ms'] as number,
        maxConcurrent: r['max_concurrent'] as number,
      };
    } catch {
      return { connectorId, ...DEFAULT_POLICY };
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  private getOrCreateMetrics(connectorId: string): ResilienceMetrics {
    if (!this.metrics.has(connectorId)) {
      this.metrics.set(connectorId, {
        connectorId,
        retryCount: 0,
        timeoutCount: 0,
        circuitBreakerTrips: 0,
        successCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        circuitState: 'closed',
      });
    }
    return this.metrics.get(connectorId)!;
  }

  /**
   * Get current metrics for a connector.
   *
   * @param connectorId - Connector identifier
   * @returns Metrics snapshot
   */
  getMetrics(connectorId: string): ResilienceMetrics {
    return { ...this.getOrCreateMetrics(connectorId) };
  }

  /**
   * Get metrics for all tracked connectors.
   *
   * @returns Array of metrics snapshots
   */
  getAllMetrics(): ResilienceMetrics[] {
    return Array.from(this.metrics.values()).map(m => ({ ...m }));
  }

  // ── Circuit Breaker ───────────────────────────────────────────────────────

  private getCircuitState(connectorId: string, policy: ResiliencePolicy): CircuitState {
    const metrics = this.getOrCreateMetrics(connectorId);
    const openAt = this.circuitOpenAt.get(connectorId);

    if (openAt !== undefined) {
      const elapsed = Date.now() - openAt;
      if (elapsed >= policy.circuitCooldownMs) {
        // Transition to half-open: allow one test request
        metrics.circuitState = 'half_open';
        return 'half_open';
      }
      metrics.circuitState = 'open';
      return 'open';
    }

    const total = metrics.successCount + metrics.failureCount;
    if (total >= 5) {
      const errorRate = metrics.failureCount / total;
      if (errorRate >= policy.circuitBreakerThreshold) {
        this.tripCircuit(connectorId, metrics);
        return 'open';
      }
    }

    metrics.circuitState = 'closed';
    return 'closed';
  }

  private tripCircuit(connectorId: string, metrics: ResilienceMetrics): void {
    this.circuitOpenAt.set(connectorId, Date.now());
    metrics.circuitState = 'open';
    metrics.circuitBreakerTrips++;
    log.warn('Circuit breaker tripped', { connectorId });
  }

  private resetCircuit(connectorId: string): void {
    this.circuitOpenAt.delete(connectorId);
    const metrics = this.getOrCreateMetrics(connectorId);
    metrics.circuitState = 'closed';
    metrics.successCount = 0;
    metrics.failureCount = 0;
  }

  // ── Bulkhead ──────────────────────────────────────────────────────────────

  private acquireSemaphore(connectorId: string, maxConcurrent: number): boolean {
    const current = this.semaphores.get(connectorId) ?? 0;
    if (current >= maxConcurrent) return false;
    this.semaphores.set(connectorId, current + 1);
    return true;
  }

  private releaseSemaphore(connectorId: string): void {
    const current = this.semaphores.get(connectorId) ?? 1;
    this.semaphores.set(connectorId, Math.max(0, current - 1));
  }

  /**
   * Execute an operation with full resilience enforcement:
   * bulkhead → circuit breaker → retry with backoff → timeout per attempt.
   *
   * @param connectorId - Connector identifier
   * @param operation - Async operation to execute
   * @param delayFn - Injectable sleep function (default: real setTimeout, override in tests)
   * @returns Operation result
   * @throws If all retries exhausted, circuit is open, or bulkhead is full
   */
  async execute<T>(
    connectorId: string,
    operation: () => Promise<T>,
    delayFn: (ms: number) => Promise<void> = (ms) => new Promise(r => setTimeout(r, ms)),
  ): Promise<T> {
    const policy = await this.getPolicy(connectorId);
    const metrics = this.getOrCreateMetrics(connectorId);

    // Bulkhead check
    if (!this.acquireSemaphore(connectorId, policy.maxConcurrent)) {
      throw new Error(`Bulkhead limit reached for connector ${connectorId} (max ${policy.maxConcurrent} concurrent)`);
    }

    try {
      // Circuit breaker check
      const state = this.getCircuitState(connectorId, policy);
      if (state === 'open') {
        throw new Error(`Circuit breaker is open for connector ${connectorId}`);
      }

      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        try {
          const result = await this.withTimeout(operation(), policy.timeoutMs);

          // Success — record and potentially reset circuit
          metrics.successCount++;
          if (state === 'half_open') {
            this.resetCircuit(connectorId);
          }
          log.debug('Operation succeeded', { connectorId, attempt });
          return result;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));

          if (lastError.message.includes('timed out')) {
            metrics.timeoutCount++;
          }

          metrics.failureCount++;
          metrics.lastFailureAt = new Date();
          log.warn('Operation failed', { connectorId, attempt, error: lastError.message });

          if (attempt < policy.maxRetries) {
            metrics.retryCount++;
            const delay = computeBackoffMs(attempt, policy);
            log.debug('Retrying after backoff', { connectorId, attempt, delayMs: delay });
            await delayFn(delay);

            // Re-check circuit after failures accumulate
            const newState = this.getCircuitState(connectorId, policy);
            if (newState === 'open') {
              throw new Error(`Circuit breaker tripped during retries for connector ${connectorId}`);
            }
          }
        }
      }

      throw lastError ?? new Error(`Operation failed for connector ${connectorId}`);
    } finally {
      this.releaseSemaphore(connectorId);
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e: unknown) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  /**
   * Manually reset a connector's circuit breaker and metrics.
   *
   * @param connectorId - Connector to reset
   */
  resetConnector(connectorId: string): void {
    this.resetCircuit(connectorId);
    this.metrics.delete(connectorId);
    this.semaphores.delete(connectorId);
  }

  /** Current in-flight count for a connector (for observability). */
  getConcurrentCount(connectorId: string): number {
    return this.semaphores.get(connectorId) ?? 0;
  }
}
