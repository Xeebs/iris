import { logger } from '@iris/core/logger';

export type ErrorCategory = 'transient' | 'permanent' | 'rate-limit';

export type ResilienceOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  circuitBreakerKey?: string;
  sql?: Sql;
};

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

// In-memory circuit breaker state for quick lookup (backed by DB for persistence)
const inMemoryCircuitState = new Map<string, {
  failureCount: number;
  lastFailureTime: number;
  state: CircuitBreakerState;
}>();

const CIRCUIT_OPEN_DURATION_MS = 30_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;

/**
 * @returns Whether the circuit is currently allowing requests through
 */
export function isCircuitClosed(key: string): boolean {
  const entry = inMemoryCircuitState.get(key);
  if (!entry) return true;
  if (entry.state === 'closed') return true;
  if (entry.state === 'open') {
    if (Date.now() - entry.lastFailureTime >= CIRCUIT_OPEN_DURATION_MS) {
      entry.state = 'half-open';
      return true;
    }
    return false;
  }
  return true; // half-open: allow one probe
}

/**
 * @returns Current circuit breaker state for a service key
 */
export function getCircuitState(key: string): CircuitBreakerState {
  return inMemoryCircuitState.get(key)?.state ?? 'closed';
}

/**
 * @returns All circuit breaker states
 */
export function getAllCircuitStates(): Record<string, { state: CircuitBreakerState; failureCount: number; lastFailureTime: number }> {
  const result: Record<string, { state: CircuitBreakerState; failureCount: number; lastFailureTime: number }> = {};
  for (const [key, val] of inMemoryCircuitState.entries()) {
    result[key] = { state: val.state, failureCount: val.failureCount, lastFailureTime: val.lastFailureTime };
  }
  return result;
}

function recordSuccess(key: string): void {
  const entry = inMemoryCircuitState.get(key);
  if (entry) {
    entry.failureCount = 0;
    entry.state = 'closed';
  }
}

function recordFailure(key: string, sql?: Sql): void {
  const existing = inMemoryCircuitState.get(key) ?? { failureCount: 0, lastFailureTime: 0, state: 'closed' as CircuitBreakerState };
  existing.failureCount += 1;
  existing.lastFailureTime = Date.now();
  if (existing.failureCount >= CIRCUIT_FAILURE_THRESHOLD) {
    existing.state = 'open';
    logger.warn('Circuit breaker opened', { service: key, failureCount: existing.failureCount });
    if (sql) {
      sql`INSERT INTO resilience_circuit_breaker_state (service, failure_count, last_failure_time, state)
          VALUES (${key}, ${existing.failureCount}, NOW(), 'open')
          ON CONFLICT (service) DO UPDATE SET
            failure_count = EXCLUDED.failure_count,
            last_failure_time = EXCLUDED.last_failure_time,
            state = EXCLUDED.state`.catch(() => undefined);
    }
  }
  inMemoryCircuitState.set(key, existing);
}

/**
 * @returns Categorized error type
 */
export function categorizeError(err: unknown): ErrorCategory {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) return 'rate-limit';
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnreset') ||
        msg.includes('econnrefused') || msg.includes('network') || msg.includes('socket')) return 'transient';
  }
  return 'permanent';
}

/**
 * Wraps an async function with timeout, retry, and circuit-breaker resilience.
 * Gracefully degrades: on circuit-open, returns the fallback result without calling fn.
 *
 * @param fn - Async function to protect
 * @param fallback - Value to return when degraded
 * @param options - ResilienceOptions
 * @returns Result of fn, or fallback on failure/circuit-open
 */
export async function applyResilience<T>(
  fn: () => Promise<T>,
  fallback: T,
  options: ResilienceOptions = {},
): Promise<T> {
  const {
    timeoutMs = 5_000,
    maxRetries = 2,
    retryDelayMs = 200,
    circuitBreakerKey,
    sql,
  } = options;

  if (circuitBreakerKey && !isCircuitClosed(circuitBreakerKey)) {
    logger.warn('Circuit breaker is open — returning fallback', { service: circuitBreakerKey });
    return fallback;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await withTimeout(fn, timeoutMs);
      if (circuitBreakerKey) recordSuccess(circuitBreakerKey);
      return result;
    } catch (err) {
      lastError = err;
      const category = categorizeError(err);
      logger.warn('Resilience: operation failed', {
        attempt,
        maxRetries,
        circuitBreakerKey,
        errorCategory: category,
        error: err instanceof Error ? err.message : String(err),
      });

      if (category === 'permanent') break;

      if (attempt < maxRetries) {
        const delay = retryDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  if (circuitBreakerKey) recordFailure(circuitBreakerKey, sql);

  logger.error('Resilience: all retries exhausted — using fallback', {
    circuitBreakerKey,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });

  return fallback;
}

function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
    fn().then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param sql - Postgres sql instance
 * @returns All circuit breaker states from DB
 */
export async function loadCircuitStateFromDb(sql: Sql): Promise<void> {
  try {
    const rows = await sql`SELECT service, failure_count, last_failure_time, state FROM resilience_circuit_breaker_state` as Array<{
      service: string;
      failure_count: number;
      last_failure_time: Date;
      state: CircuitBreakerState;
    }>;
    for (const row of rows) {
      inMemoryCircuitState.set(row.service, {
        failureCount: row.failure_count,
        lastFailureTime: new Date(row.last_failure_time).getTime(),
        state: row.state,
      });
    }
  } catch {
    // DB unavailable — proceed with empty state
  }
}

/** @internal Reset for tests */
export function _resetCircuitState(): void {
  inMemoryCircuitState.clear();
}
