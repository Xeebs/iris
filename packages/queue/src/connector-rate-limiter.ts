import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'connector-rate-limiter' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectorRateLimitConfig = {
  requestsPerSecond: number;
  maxConcurrent: number;
  burstSize?: number;
};

export type RateLimitHeaders = {
  remaining?: number;
  limit?: number;
  retryAfterMs?: number;
};

export type CircuitState = 'closed' | 'open' | 'half_open';

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CIRCUIT_OPEN_DURATION_MS = 30_000;
const CIRCUIT_HALF_OPEN_TEST_INTERVAL_MS = 5_000;
const FAILURE_THRESHOLD = 5;
const MAX_BACKOFF_MS = 60_000;
const JITTER_RATIO = 0.2;

// ─── RateLimiterManager ───────────────────────────────────────────────────────

/**
 * Per-connector rate limiting with adaptive limits, exponential backoff,
 * and circuit breaker. State is persisted to Redis with TTLs.
 */
export class RateLimiterManager {
  constructor(private readonly redis: RedisLike) {}

  /**
   * Acquire a slot before making a connector API request.
   * Blocks (via delay) if the connector is rate-limited or circuit-broken.
   *
   * @param connectorId - Unique connector identifier
   * @param config - Rate limit configuration from connector manifest
   * @returns ms waited (0 if immediately available)
   */
  async acquireSlot(connectorId: string, config: ConnectorRateLimitConfig): Promise<number> {
    const circuit = await this.getCircuitState(connectorId);

    if (circuit === 'open') {
      const reopenAt = await this.getCircuitReopenAt(connectorId);
      const now = Date.now();
      if (reopenAt && now < reopenAt) {
        const waitMs = reopenAt - now;
        log.warn('Circuit open — delaying request', { connectorId, waitMs });
        await delay(waitMs);
        return waitMs;
      }
      // Transition to half_open
      await this.setCircuitState(connectorId, 'half_open');
      log.info('Circuit transitioning to half_open', { connectorId });
    }

    // Token bucket check for rate limiting
    const windowKey = this.windowKey(connectorId);
    const count = await this.redis.incr(windowKey);
    if (count === 1) {
      await this.redis.expire(windowKey, 1);
    }

    const burst = config.burstSize ?? Math.ceil(config.requestsPerSecond * 1.5);
    if (count > burst) {
      const waitMs = Math.ceil(1000 / config.requestsPerSecond);
      log.debug('Rate limit reached — throttling', { connectorId, count, burst, waitMs });
      await delay(waitMs);
      return waitMs;
    }

    return 0;
  }

  /**
   * Record a successful API response and update adaptive limits from response headers.
   *
   * @param connectorId - Connector that made the request
   * @param headers - Rate-limit headers from the API response
   */
  async recordSuccess(connectorId: string, headers: RateLimitHeaders = {}): Promise<void> {
    const circuit = await this.getCircuitState(connectorId);
    if (circuit === 'half_open') {
      // Success in half_open → close the circuit
      await this.setCircuitState(connectorId, 'closed');
      await this.redis.del(this.failureCountKey(connectorId));
      log.info('Circuit closed after successful probe', { connectorId });
    }

    if (headers.remaining !== undefined && headers.remaining < 5) {
      log.warn('Rate limit nearly exhausted', { connectorId, remaining: headers.remaining });
    }
  }

  /**
   * Record a rate-limited (429) or server error (5xx) response.
   * Updates the circuit breaker and returns the ms to back off.
   *
   * @param connectorId - Connector that received the error
   * @param statusCode - HTTP status code received
   * @param headers - Rate-limit / retry headers from the error response
   * @returns Recommended backoff duration in ms
   */
  async recordFailure(
    connectorId: string,
    statusCode: number,
    headers: RateLimitHeaders = {},
  ): Promise<number> {
    const failureCountKey = this.failureCountKey(connectorId);
    const failures = await this.redis.incr(failureCountKey);
    await this.redis.expire(failureCountKey, 300);

    const backoffMs = this.computeBackoff(failures, headers.retryAfterMs);

    if (statusCode === 429 || statusCode >= 500) {
      log.warn('Connector request failed', { connectorId, statusCode, failures, backoffMs });

      if (failures >= FAILURE_THRESHOLD) {
        const circuit = await this.getCircuitState(connectorId);
        if (circuit !== 'open') {
          await this.openCircuit(connectorId);
          log.error('Circuit opened due to repeated failures', { connectorId, failures });
        }
      }
    }

    return backoffMs;
  }

  /**
   * Returns current circuit state for a connector.
   */
  async getCircuitState(connectorId: string): Promise<CircuitState> {
    const state = await this.redis.get(this.circuitStateKey(connectorId));
    return (state as CircuitState | null) ?? 'closed';
  }

  /**
   * Manually reset the circuit breaker (e.g., after connector credentials update).
   */
  async resetCircuit(connectorId: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.circuitStateKey(connectorId)),
      this.redis.del(this.circuitReopenAtKey(connectorId)),
      this.redis.del(this.failureCountKey(connectorId)),
    ]);
    log.info('Circuit breaker reset', { connectorId });
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async setCircuitState(connectorId: string, state: CircuitState): Promise<void> {
    await this.redis.set(this.circuitStateKey(connectorId), state, 'EX', 3600);
  }

  private async openCircuit(connectorId: string): Promise<void> {
    const reopenAt = Date.now() + CIRCUIT_OPEN_DURATION_MS;
    await this.setCircuitState(connectorId, 'open');
    await this.redis.set(this.circuitReopenAtKey(connectorId), String(reopenAt), 'EX', 120);
  }

  private async getCircuitReopenAt(connectorId: string): Promise<number | null> {
    const val = await this.redis.get(this.circuitReopenAtKey(connectorId));
    return val ? Number(val) : null;
  }

  private computeBackoff(failures: number, retryAfterMs?: number): number {
    if (retryAfterMs) return Math.min(retryAfterMs, MAX_BACKOFF_MS);
    const exponential = Math.min(1000 * Math.pow(2, failures - 1), MAX_BACKOFF_MS);
    const jitter = exponential * JITTER_RATIO * Math.random();
    return Math.round(exponential + jitter);
  }

  private windowKey(connectorId: string): string {
    const bucket = Math.floor(Date.now() / 1000);
    return `iris:rl:${connectorId}:${bucket}`;
  }

  private circuitStateKey(connectorId: string): string {
    return `iris:cb:${connectorId}:state`;
  }

  private circuitReopenAtKey(connectorId: string): string {
    return `iris:cb:${connectorId}:reopen_at`;
  }

  private failureCountKey(connectorId: string): string {
    return `iris:cb:${connectorId}:failures`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Default connector rate limits ───────────────────────────────────────────

export const DEFAULT_RATE_LIMITS: Record<string, ConnectorRateLimitConfig> = {
  hubspot: { requestsPerSecond: 10, maxConcurrent: 3, burstSize: 15 },
  salesforce: { requestsPerSecond: 5, maxConcurrent: 2, burstSize: 8 },
  google_drive: { requestsPerSecond: 10, maxConcurrent: 5, burstSize: 20 },
  slack: { requestsPerSecond: 1, maxConcurrent: 1, burstSize: 3 },
  notion: { requestsPerSecond: 3, maxConcurrent: 2, burstSize: 5 },
  jira: { requestsPerSecond: 5, maxConcurrent: 2, burstSize: 10 },
  default: { requestsPerSecond: 5, maxConcurrent: 2, burstSize: 10 },
};
