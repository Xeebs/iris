import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'connector-health-monitor' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthSeverity = 'critical' | 'warning' | 'info';

export type FailureType =
  | 'high_error_rate'
  | 'high_latency'
  | 'low_success_rate'
  | 'auth_failure'
  | 'rate_limited'
  | 'schema_drift'
  | 'no_data';

export type RecoveryAction =
  | 'retry_sync'
  | 'rotate_credentials'
  | 'check_rate_limits'
  | 'update_schema'
  | 'verify_permissions'
  | 'contact_support'
  | 'increase_timeout'
  | 'reduce_batch_size';

export type SyncMetrics = {
  connectorId: string;
  workspaceId: string;
  syncDurationMs: number;
  recordCount: number;
  errorCount: number;
  throttledRequests: number;
};

export type HealthScore = {
  connectorId: string;
  workspaceId: string;
  score: number;
  lastSyncSuccessRate: number;
  lastSyncLatencyMs: number;
  lastErrorRate: number;
  lastThrottleRate: number;
  lastCheckedAt: Date;
};

export type HealthAlert = {
  id: string;
  connectorId: string;
  workspaceId: string;
  severity: HealthSeverity;
  failureType: FailureType;
  suggestedAction: RecoveryAction;
  acknowledgedAt: Date | null;
  createdAt: Date;
};

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Thresholds ───────────────────────────────────────────────────────────────

const THRESHOLDS = {
  minSuccessRate: 95,
  maxLatencyMs: 30_000,
  maxErrorRate: 5,
  maxThrottleRate: 20,
} as const;

// ─── Score computation ────────────────────────────────────────────────────────

/**
 * Compute a 0-100 health score from sync metrics.
 * Weighted: success rate 50%, latency 20%, error rate 20%, throttle 10%.
 *
 * @param successRate - Percentage of records synced without error (0–100)
 * @param latencyMs - Sync duration in ms
 * @param errorRate - Percentage of records that errored (0–100)
 * @param throttleRate - Percentage of requests that were throttled (0–100)
 */
export function computeHealthScore(
  successRate: number,
  latencyMs: number,
  errorRate: number,
  throttleRate: number,
): number {
  const successComponent = Math.min(100, successRate) * 0.5;

  const latencyMax = THRESHOLDS.maxLatencyMs;
  const latencyScore = latencyMs <= latencyMax
    ? 100
    : Math.max(0, 100 - ((latencyMs - latencyMax) / latencyMax) * 100);
  const latencyComponent = latencyScore * 0.2;

  const errorScore = Math.max(0, 100 - errorRate * 2);
  const errorComponent = errorScore * 0.2;

  const throttleScore = Math.max(0, 100 - throttleRate * 1.5);
  const throttleComponent = throttleScore * 0.1;

  return Math.round(successComponent + latencyComponent + errorComponent + throttleComponent);
}

/**
 * Determine severity level from health score.
 *
 * @param score - Health score 0–100
 */
export function scoreToSeverity(score: number): HealthSeverity {
  if (score < 50) return 'critical';
  if (score < 80) return 'warning';
  return 'info';
}

// ─── Recovery suggestion map ──────────────────────────────────────────────────

const RECOVERY_MAP: Record<FailureType, RecoveryAction> = {
  high_error_rate: 'retry_sync',
  high_latency: 'increase_timeout',
  low_success_rate: 'reduce_batch_size',
  auth_failure: 'rotate_credentials',
  rate_limited: 'check_rate_limits',
  schema_drift: 'update_schema',
  no_data: 'verify_permissions',
};

/**
 * Recommend a recovery action for a given failure type.
 *
 * @param failureType - Type of failure detected
 */
export function suggestRecoveryAction(failureType: FailureType): RecoveryAction {
  return RECOVERY_MAP[failureType] ?? 'contact_support';
}

/**
 * Infer the most likely failure type from sync metrics.
 *
 * @param metrics - Raw sync metrics
 */
export function inferFailureType(metrics: SyncMetrics): FailureType | null {
  const total = metrics.recordCount + metrics.errorCount;
  if (total === 0) return 'no_data';

  const errorRate = total > 0 ? (metrics.errorCount / total) * 100 : 0;
  const throttleRate = total > 0 ? (metrics.throttledRequests / total) * 100 : 0;

  if (errorRate >= THRESHOLDS.maxErrorRate) return 'high_error_rate';
  if (metrics.syncDurationMs > THRESHOLDS.maxLatencyMs) return 'high_latency';
  if (throttleRate >= THRESHOLDS.maxThrottleRate) return 'rate_limited';
  return null;
}

// ─── ConnectorHealthMonitor ───────────────────────────────────────────────────

export class ConnectorHealthMonitor {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Record sync metrics and update the health score for a connector.
   *
   * @param metrics - Sync metrics for the completed sync run
   */
  async trackSyncMetrics(metrics: SyncMetrics): Promise<Result<HealthScore, Error>> {
    try {
      const total = metrics.recordCount + metrics.errorCount;
      const successRate = total > 0
        ? ((metrics.recordCount) / total) * 100
        : 100;
      const errorRate = total > 0
        ? (metrics.errorCount / total) * 100
        : 0;
      const throttleRate = total > 0
        ? (metrics.throttledRequests / total) * 100
        : 0;

      const score = computeHealthScore(
        successRate,
        metrics.syncDurationMs,
        errorRate,
        throttleRate,
      );

      await this.sql`
        INSERT INTO connector_health_scores
          (connector_id, workspace_id, score, last_sync_success_rate, last_sync_latency_ms, last_error_rate, last_throttle_rate, last_checked_at)
        VALUES
          (${metrics.connectorId}, ${metrics.workspaceId}, ${score}, ${successRate}, ${metrics.syncDurationMs}, ${errorRate}, ${throttleRate}, NOW())
        ON CONFLICT (connector_id, workspace_id) DO UPDATE SET
          score = EXCLUDED.score,
          last_sync_success_rate = EXCLUDED.last_sync_success_rate,
          last_sync_latency_ms = EXCLUDED.last_sync_latency_ms,
          last_error_rate = EXCLUDED.last_error_rate,
          last_throttle_rate = EXCLUDED.last_throttle_rate,
          last_checked_at = NOW()
      `;

      log.info('Sync metrics tracked', {
        connectorId: metrics.connectorId,
        workspaceId: metrics.workspaceId,
        score,
        successRate,
      });

      return ok({
        connectorId: metrics.connectorId,
        workspaceId: metrics.workspaceId,
        score,
        lastSyncSuccessRate: successRate,
        lastSyncLatencyMs: metrics.syncDurationMs,
        lastErrorRate: errorRate,
        lastThrottleRate: throttleRate,
        lastCheckedAt: new Date(),
      });
    } catch (e) {
      log.error('trackSyncMetrics failed', { connectorId: metrics.connectorId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Detect whether a connector is in an unhealthy state based on stored metrics.
   *
   * @param connectorId - Connector to inspect
   * @param workspaceId - Workspace ID
   */
  async detectUnhealthyState(
    connectorId: string,
    workspaceId: string,
  ): Promise<Result<{ unhealthy: boolean; reasons: string[] }, Error>> {
    try {
      const rows = await this.sql`
        SELECT score, last_sync_success_rate, last_sync_latency_ms, last_error_rate, last_throttle_rate
        FROM connector_health_scores
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
      ` as Array<{
        score: number;
        last_sync_success_rate: number;
        last_sync_latency_ms: number;
        last_error_rate: number;
        last_throttle_rate: number;
      }>;

      if (rows.length === 0) {
        return ok({ unhealthy: false, reasons: [] });
      }

      const row = rows[0]!;
      const reasons: string[] = [];

      if (row.last_sync_success_rate < THRESHOLDS.minSuccessRate) {
        reasons.push(`Success rate ${row.last_sync_success_rate.toFixed(1)}% below ${THRESHOLDS.minSuccessRate}% threshold`);
      }
      if (row.last_sync_latency_ms > THRESHOLDS.maxLatencyMs) {
        reasons.push(`Latency ${row.last_sync_latency_ms}ms exceeds ${THRESHOLDS.maxLatencyMs}ms threshold`);
      }
      if (row.last_error_rate > THRESHOLDS.maxErrorRate) {
        reasons.push(`Error rate ${row.last_error_rate.toFixed(1)}% exceeds ${THRESHOLDS.maxErrorRate}% threshold`);
      }
      if (row.last_throttle_rate > THRESHOLDS.maxThrottleRate) {
        reasons.push(`Throttle rate ${row.last_throttle_rate.toFixed(1)}% exceeds ${THRESHOLDS.maxThrottleRate}% threshold`);
      }

      return ok({ unhealthy: reasons.length > 0, reasons });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Suggest a recovery action for a connector failure type.
   *
   * @param connectorId - Connector to suggest recovery for
   * @param failureType - Type of failure detected
   */
  suggestRecovery(connectorId: string, failureType: FailureType): RecoveryAction {
    const action = suggestRecoveryAction(failureType);
    log.info('Recovery suggestion', { connectorId, failureType, action });
    return action;
  }

  /**
   * Emit a health alert for a connector and persist it to the database.
   *
   * @param connectorId - Connector affected
   * @param workspaceId - Workspace ID
   * @param severity - Alert severity level
   * @param failureType - Root cause of the health degradation
   */
  async emitHealthAlert(
    connectorId: string,
    workspaceId: string,
    severity: HealthSeverity,
    failureType: FailureType,
  ): Promise<Result<HealthAlert, Error>> {
    const suggestedAction = suggestRecoveryAction(failureType);

    try {
      const rows = await this.sql`
        INSERT INTO health_alerts (connector_id, workspace_id, severity, failure_type, suggested_action)
        VALUES (${connectorId}, ${workspaceId}, ${severity}, ${failureType}, ${suggestedAction})
        RETURNING id, created_at
      ` as Array<{ id: string; created_at: string }>;

      const row = rows[0]!;

      log.warn('Health alert emitted', { connectorId, workspaceId, severity, failureType });

      return ok({
        id: row.id,
        connectorId,
        workspaceId,
        severity,
        failureType,
        suggestedAction,
        acknowledgedAt: null,
        createdAt: new Date(row.created_at),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the current health score and unacknowledged alerts for a connector.
   *
   * @param connectorId - Connector to query
   * @param workspaceId - Workspace ID
   */
  async getHealthScore(
    connectorId: string,
    workspaceId: string,
  ): Promise<Result<{ score: HealthScore | null; alerts: HealthAlert[] }, Error>> {
    try {
      const [scoreRows, alertRows] = await Promise.all([
        this.sql`
          SELECT connector_id, workspace_id, score, last_sync_success_rate, last_sync_latency_ms,
                 last_error_rate, last_throttle_rate, last_checked_at
          FROM connector_health_scores
          WHERE connector_id = ${connectorId}
            AND workspace_id = ${workspaceId}
        ` as unknown as Array<{
          connector_id: string;
          workspace_id: string;
          score: number;
          last_sync_success_rate: number;
          last_sync_latency_ms: number;
          last_error_rate: number;
          last_throttle_rate: number;
          last_checked_at: string;
        }>,
        this.sql`
          SELECT id, connector_id, workspace_id, severity, failure_type, suggested_action, acknowledged_at, created_at
          FROM health_alerts
          WHERE connector_id = ${connectorId}
            AND workspace_id = ${workspaceId}
            AND acknowledged_at IS NULL
          ORDER BY created_at DESC
          LIMIT 20
        ` as unknown as Array<{
          id: string;
          connector_id: string;
          workspace_id: string;
          severity: HealthSeverity;
          failure_type: FailureType;
          suggested_action: RecoveryAction;
          acknowledged_at: string | null;
          created_at: string;
        }>,
      ]);

      const score: HealthScore | null = scoreRows[0]
        ? {
            connectorId: scoreRows[0].connector_id,
            workspaceId: scoreRows[0].workspace_id,
            score: scoreRows[0].score,
            lastSyncSuccessRate: Number(scoreRows[0].last_sync_success_rate),
            lastSyncLatencyMs: scoreRows[0].last_sync_latency_ms,
            lastErrorRate: Number(scoreRows[0].last_error_rate),
            lastThrottleRate: Number(scoreRows[0].last_throttle_rate),
            lastCheckedAt: new Date(scoreRows[0].last_checked_at),
          }
        : null;

      const alerts: HealthAlert[] = alertRows.map((r) => ({
        id: r.id,
        connectorId: r.connector_id,
        workspaceId: r.workspace_id,
        severity: r.severity,
        failureType: r.failure_type,
        suggestedAction: r.suggested_action,
        acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at) : null,
        createdAt: new Date(r.created_at),
      }));

      return ok({ score, alerts });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Acknowledge a health alert to dismiss it from the active alert list.
   *
   * @param alertId - ID of the alert to acknowledge
   */
  async acknowledgeAlert(alertId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE health_alerts
        SET acknowledged_at = NOW()
        WHERE id = ${alertId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
