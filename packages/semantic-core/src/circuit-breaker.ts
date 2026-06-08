import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'circuit-breaker' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half_open';

export type CircuitBreakerConfig = {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failThreshold: number;
  /** Error rate (0–1) over the rolling window that triggers opening. Default: 0.5 */
  errorRateThreshold: number;
  /** Rolling window duration in ms for error rate calculation. Default: 60_000 */
  windowMs: number;
  /** Time in ms the circuit stays OPEN before transitioning to HALF_OPEN. Default: 30_000 */
  cooldownMs: number;
  /** Number of successes in HALF_OPEN to return to CLOSED. Default: 2 */
  halfOpenSuccessThreshold: number;
};

export type CircuitStatus = {
  connectorId: string;
  workspaceId: string;
  state: CircuitState;
  failCount: number;
  successCount: number;
  lastFailureAt: Date | null;
  openedAt: Date | null;
  halfOpenAt: Date | null;
  updatedAt: Date;
};

export type AttemptRecord = {
  success: boolean;
  latencyMs: number;
  errorCode?: string;
};

export type FallbackContext = {
  entities: unknown[];
  cachedAt: Date;
  stale: boolean;
};

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failThreshold: 5,
  errorRateThreshold: 0.5,
  windowMs: 60_000,
  cooldownMs: 30_000,
  halfOpenSuccessThreshold: 2,
};

// ─── Pure state machine helpers ───────────────────────────────────────────────

/**
 * Determine the next circuit state given the current state and attempt outcome.
 */
export function computeNextState(
  current: CircuitState,
  failCount: number,
  successInHalfOpen: number,
  openedAt: Date | null,
  config: CircuitBreakerConfig,
  attemptSuccess: boolean,
  now = new Date(),
): CircuitState {
  if (current === 'open') {
    if (openedAt && now.getTime() - openedAt.getTime() >= config.cooldownMs) {
      return 'half_open';
    }
    return 'open';
  }

  if (current === 'half_open') {
    if (!attemptSuccess) return 'open';
    if (successInHalfOpen + 1 >= config.halfOpenSuccessThreshold) return 'closed';
    return 'half_open';
  }

  // CLOSED — open on consecutive failure threshold
  if (!attemptSuccess && failCount + 1 >= config.failThreshold) {
    return 'open';
  }
  return 'closed';
}

/**
 * Calculate recent error rate from a list of events in a rolling window.
 */
export function computeErrorRate(
  events: { success: boolean; occurredAt: Date }[],
  windowMs: number,
  now = new Date(),
): number {
  const cutoff = new Date(now.getTime() - windowMs);
  const recent = events.filter((e) => e.occurredAt >= cutoff);
  if (recent.length === 0) return 0;
  const failures = recent.filter((e) => !e.success).length;
  return failures / recent.length;
}

// ─── CircuitBreakerService ────────────────────────────────────────────────────

export class CircuitBreakerService {
  private readonly config: CircuitBreakerConfig;

  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    config: Partial<CircuitBreakerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute an operation through the circuit breaker.
   * Returns Err if the circuit is OPEN (fallback should be used).
   *
   * @param connectorId - Connector identifier
   * @param workspaceId - Workspace identifier
   * @param fn          - The operation to execute
   */
  async execute<T>(
    connectorId: string,
    workspaceId: string,
    fn: () => Promise<T>,
  ): Promise<Result<T, Error>> {
    const status = await this.getStatus(connectorId, workspaceId);

    if (status.isErr()) return err(status.error);

    let current = status.value;

    // Transition OPEN → HALF_OPEN if cooldown elapsed
    if (current.state === 'open') {
      if (current.openedAt && Date.now() - current.openedAt.getTime() >= this.config.cooldownMs) {
        await this.transitionState(connectorId, workspaceId, 'half_open', current.state);
        current = { ...current, state: 'half_open', halfOpenAt: new Date() };
      } else {
        log.warn('Circuit is OPEN — short-circuiting', { connectorId, workspaceId });
        return err(new Error(`Circuit breaker OPEN for connector: ${connectorId}`));
      }
    }

    const start = Date.now();
    try {
      const result = await fn();
      await this.recordAttempt(connectorId, workspaceId, { success: true, latencyMs: Date.now() - start }, current.state);
      return ok(result);
    } catch (e) {
      const errorCode = e instanceof Error ? e.constructor.name : 'UnknownError';
      await this.recordAttempt(connectorId, workspaceId, { success: false, latencyMs: Date.now() - start, errorCode }, current.state);
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the current circuit status, initializing a CLOSED record if absent.
   */
  async getStatus(connectorId: string, workspaceId: string): Promise<Result<CircuitStatus, Error>> {
    try {
      type Row = {
        connector_id: string;
        workspace_id: string;
        state: CircuitState;
        fail_count: number;
        success_count: number;
        last_failure_at: Date | null;
        opened_at: Date | null;
        half_open_at: Date | null;
        updated_at: Date;
      };

      const rows = await this.sql<Row[]>`
        INSERT INTO circuit_breaker_state (connector_id, workspace_id)
        VALUES (${connectorId}, ${workspaceId})
        ON CONFLICT (connector_id, workspace_id) DO NOTHING;

        SELECT connector_id, workspace_id, state, fail_count, success_count,
               last_failure_at, opened_at, half_open_at, updated_at
        FROM circuit_breaker_state
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
      `;

      const r = rows[0];
      if (!r) return err(new Error('Failed to initialize circuit breaker state'));

      return ok({
        connectorId: r.connector_id,
        workspaceId: r.workspace_id,
        state: r.state,
        failCount: r.fail_count,
        successCount: r.success_count,
        lastFailureAt: r.last_failure_at,
        openedAt: r.opened_at,
        halfOpenAt: r.half_open_at,
        updatedAt: r.updated_at,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record the result of an attempt and update circuit state accordingly.
   */
  async recordAttempt(
    connectorId: string,
    workspaceId: string,
    attempt: AttemptRecord,
    currentState: CircuitState,
  ): Promise<void> {
    try {
      await this.sql`
        INSERT INTO circuit_breaker_events
          (connector_id, workspace_id, event_type, latency_ms, error_code, previous_state, new_state)
        VALUES (
          ${connectorId}, ${workspaceId},
          ${attempt.success ? 'attempt_success' : 'attempt_failure'},
          ${attempt.latencyMs},
          ${attempt.errorCode ?? null},
          ${currentState}, ${currentState}
        )
      `;

      if (attempt.success) {
        if (currentState === 'half_open') {
          // Check if we've hit the half-open success threshold
          const countRows = await this.sql<{ cnt: number }[]>`
            SELECT COUNT(*) AS cnt
            FROM circuit_breaker_events
            WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
              AND event_type = 'attempt_success'
              AND occurred_at > (
                SELECT COALESCE(half_open_at, NOW() - INTERVAL '1 hour')
                FROM circuit_breaker_state
                WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
              )
          `;
          const successCount = Number(countRows[0]?.cnt ?? 0);
          if (successCount >= this.config.halfOpenSuccessThreshold) {
            await this.transitionState(connectorId, workspaceId, 'closed', 'half_open');
          }
        } else {
          await this.sql`
            UPDATE circuit_breaker_state
            SET success_count = success_count + 1, fail_count = 0, updated_at = NOW()
            WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
          `;
        }
      } else {
        const updated = await this.sql<{ fail_count: number; state: CircuitState }[]>`
          UPDATE circuit_breaker_state
          SET fail_count = fail_count + 1,
              last_failure_at = NOW(),
              updated_at = NOW()
          WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
          RETURNING fail_count, state
        `;

        const row = updated[0];
        if (row && row.state !== 'open' && row.fail_count >= this.config.failThreshold) {
          await this.transitionState(connectorId, workspaceId, 'open', row.state);
        } else if (row && row.state === 'half_open') {
          await this.transitionState(connectorId, workspaceId, 'open', 'half_open');
        }
      }
    } catch (e) {
      log.error('Failed to record circuit breaker attempt', { connectorId, error: e });
    }
  }

  /**
   * Manually reset a circuit to CLOSED state.
   */
  async resetCircuit(connectorId: string, workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.transitionState(connectorId, workspaceId, 'closed', 'manual_reset' as CircuitState);
      log.info('Circuit manually reset', { connectorId, workspaceId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async transitionState(
    connectorId: string,
    workspaceId: string,
    newState: CircuitState,
    previousState: CircuitState | 'manual_reset',
  ): Promise<void> {
    const openedAt = newState === 'open' ? 'NOW()' : null;
    const halfOpenAt = newState === 'half_open' ? 'NOW()' : null;
    const eventType =
      newState === 'open' ? 'state_opened'
      : newState === 'half_open' ? 'state_half_opened'
      : 'state_closed';

    await this.sql`
      UPDATE circuit_breaker_state
      SET state = ${newState},
          fail_count = CASE WHEN ${newState} = 'closed' THEN 0 ELSE fail_count END,
          success_count = CASE WHEN ${newState} = 'closed' THEN 0 ELSE success_count END,
          opened_at = CASE WHEN ${newState} = 'open' THEN NOW() ELSE opened_at END,
          half_open_at = CASE WHEN ${newState} = 'half_open' THEN NOW() ELSE half_open_at END,
          updated_at = NOW()
      WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
    `;
    void openedAt;
    void halfOpenAt;

    await this.sql`
      INSERT INTO circuit_breaker_events
        (connector_id, workspace_id, event_type, previous_state, new_state)
      VALUES (${connectorId}, ${workspaceId}, ${eventType}, ${previousState}, ${newState})
    `;

    log.info('Circuit state transition', { connectorId, workspaceId, previousState, newState });
  }
}
