import { ok, err, type Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ module: 'reliability-predictor' });

// ─── Types ────────────────────────────────────────────────────────────────────

type ReliabilityScore = {
  connectorId: string;
  score: number;
  successRate: number;
  latencyP95Ms: number;
  errorRate: number;
  schemaStability: number;
  trend: 'improving' | 'stable' | 'degrading';
  computedAt: Date;
};

type DegradationPattern = {
  connectorId: string;
  anomalyDetected: boolean;
  zScoreErrorRate: number;
  zScoreLatency: number;
  authFailures: number;
  dominantSignal: string | null;
};

type FailureForecast = {
  connectorId: string;
  likelihood1h: number;
  likelihood24h: number;
  likelihood7d: number;
  smoothedErrorRate: number;
};

type ProactiveAlert = {
  connectorId: string;
  alertType: 'warning' | 'critical' | 'anomaly' | 'forecast';
  reason: string;
  scoreAtAlert: number | null;
};

type MitigationSuggestion = {
  action: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
};

type ReliabilityError = { code: string; message: string };

type SyncOutcome = {
  succeededAt: Date;
  latencyMs: number;
  errorCode: string | null;
};

type SqlClient = ReturnType<typeof postgres>;

// ─── Constants ────────────────────────────────────────────────────────────────

const WEIGHT_SUCCESS_RATE = 0.40;
const WEIGHT_LATENCY_P95 = 0.30;
const WEIGHT_ERROR_RATE = 0.20;
const WEIGHT_SCHEMA_STABILITY = 0.10;

const ZSCORE_ANOMALY_THRESHOLD = 2.0;
const WARNING_SCORE_THRESHOLD = 70;
const CRITICAL_SCORE_THRESHOLD = 40;
const FORECAST_CRITICAL_THRESHOLD = 0.80;

// ─── ReliabilityPredictor ─────────────────────────────────────────────────────

/**
 * Computes connector reliability scores, detects degradation, and forecasts failure.
 */
export class ReliabilityPredictor {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Computes time-weighted reliability score 0–100 from recent sync outcomes.
   * @param connectorId - Connector to evaluate
   * @param workspaceId - Workspace scope
   * @param windowMs - Lookback window in milliseconds (default: 24h)
   * @returns Reliability score with component breakdown and trend
   */
  async computeReliabilityScore(
    connectorId: string,
    workspaceId: string,
    windowMs = 86_400_000,
  ): Promise<Result<ReliabilityScore, ReliabilityError>> {
    try {
      const since = new Date(Date.now() - windowMs);

      const outcomes = await this.sql<SyncOutcome[]>`
        SELECT
          succeeded_at AS "succeededAt",
          latency_ms   AS "latencyMs",
          error_code   AS "errorCode"
        FROM sync_outcomes
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND succeeded_at >= ${since}
        ORDER BY succeeded_at DESC
        LIMIT 500
      `;

      const schemaRows = await this.sql<{ change_count: number }[]>`
        SELECT COUNT(*)::INTEGER AS change_count
        FROM schema_evolution_log
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND detected_at >= ${since}
      `;

      const schemaChanges = schemaRows[0]?.change_count ?? 0;
      const computedAt = new Date();

      if (outcomes.length === 0) {
        const score: ReliabilityScore = {
          connectorId,
          score: 100,
          successRate: 1,
          latencyP95Ms: 0,
          errorRate: 0,
          schemaStability: 1,
          trend: 'stable',
          computedAt,
        };
        await this.persistScore(connectorId, workspaceId, score, windowMs);
        return ok(score);
      }

      const successCount = outcomes.filter((o) => !o.errorCode).length;
      const successRate = successCount / outcomes.length;
      const errorRate = 1 - successRate;

      const latencies = outcomes.map((o) => o.latencyMs).sort((a, b) => a - b);
      const p95Idx = Math.floor(latencies.length * 0.95);
      const latencyP95Ms = latencies[p95Idx] ?? 0;

      // Normalise latency p95: 0ms=1.0, 10000ms=0.0 (linear)
      const latencyNorm = Math.max(0, 1 - latencyP95Ms / 10_000);
      // Schema stability: no changes=1.0, 10+ changes=0.0
      const schemaStability = Math.max(0, 1 - schemaChanges / 10);

      const rawScore =
        successRate * WEIGHT_SUCCESS_RATE * 100 +
        latencyNorm * WEIGHT_LATENCY_P95 * 100 +
        (1 - errorRate) * WEIGHT_ERROR_RATE * 100 +
        schemaStability * WEIGHT_SCHEMA_STABILITY * 100;

      const score = Math.round(Math.min(100, Math.max(0, rawScore)));

      // Trend: compare first vs second half of window
      const midpoint = Math.floor(outcomes.length / 2);
      const recentHalf = outcomes.slice(0, midpoint);
      const olderHalf = outcomes.slice(midpoint);
      const recentSuccessRate = recentHalf.filter((o) => !o.errorCode).length / (recentHalf.length || 1);
      const olderSuccessRate = olderHalf.filter((o) => !o.errorCode).length / (olderHalf.length || 1);
      const trend =
        recentSuccessRate - olderSuccessRate > 0.05
          ? 'improving'
          : recentSuccessRate - olderSuccessRate < -0.05
            ? 'degrading'
            : 'stable';

      const scoreObj: ReliabilityScore = {
        connectorId,
        score,
        successRate,
        latencyP95Ms,
        errorRate,
        schemaStability,
        trend,
        computedAt,
      };

      await this.persistScore(connectorId, workspaceId, scoreObj, windowMs);
      log.info('Computed reliability score', { connectorId, score, trend });

      return ok(scoreObj);
    } catch (e) {
      log.error('Failed to compute reliability score', { connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Uses Z-score analysis to detect statistical anomalies in error rate and latency.
   * @param connectorId - Connector to analyse
   * @param workspaceId - Workspace scope
   * @returns Degradation pattern with anomaly flags and dominant signal
   */
  async detectDegradationPattern(
    connectorId: string,
    workspaceId: string,
  ): Promise<Result<DegradationPattern, ReliabilityError>> {
    try {
      const rows = await this.sql<{
        bucket_hour: Date;
        error_count: number;
        total_count: number;
        avg_latency: number;
        auth_failures: number;
      }[]>`
        SELECT
          DATE_TRUNC('hour', succeeded_at) AS bucket_hour,
          COUNT(*) FILTER (WHERE error_code IS NOT NULL)::INTEGER AS error_count,
          COUNT(*)::INTEGER AS total_count,
          AVG(latency_ms)::NUMERIC AS avg_latency,
          COUNT(*) FILTER (WHERE error_code = 'AUTH_FAILURE')::INTEGER AS auth_failures
        FROM sync_outcomes
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND succeeded_at >= NOW() - INTERVAL '7 days'
        GROUP BY bucket_hour
        ORDER BY bucket_hour DESC
        LIMIT 168
      `;

      if (rows.length < 3) {
        return ok({
          connectorId,
          anomalyDetected: false,
          zScoreErrorRate: 0,
          zScoreLatency: 0,
          authFailures: 0,
          dominantSignal: null,
        });
      }

      const errorRates = rows.map((r) =>
        r.total_count > 0 ? r.error_count / r.total_count : 0,
      );
      const latencies = rows.map((r) => Number(r.avg_latency) ?? 0);
      const totalAuthFailures = rows.reduce((sum, r) => sum + r.auth_failures, 0);

      const zScoreErrorRate = computeZScore(errorRates);
      const zScoreLatency = computeZScore(latencies);

      const anomalyDetected =
        Math.abs(zScoreErrorRate) > ZSCORE_ANOMALY_THRESHOLD ||
        Math.abs(zScoreLatency) > ZSCORE_ANOMALY_THRESHOLD ||
        totalAuthFailures > 5;

      let dominantSignal: string | null = null;
      if (totalAuthFailures > 5) {
        dominantSignal = 'auth_failures';
      } else if (Math.abs(zScoreErrorRate) > Math.abs(zScoreLatency)) {
        dominantSignal = 'error_rate_spike';
      } else if (Math.abs(zScoreLatency) > ZSCORE_ANOMALY_THRESHOLD) {
        dominantSignal = 'latency_spike';
      }

      return ok({
        connectorId,
        anomalyDetected,
        zScoreErrorRate: Math.round(zScoreErrorRate * 100) / 100,
        zScoreLatency: Math.round(zScoreLatency * 100) / 100,
        authFailures: totalAuthFailures,
        dominantSignal,
      });
    } catch (e) {
      log.error('Failed to detect degradation pattern', { connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Applies exponential smoothing to predict failure likelihood over 1h/24h/7d windows.
   * @param connectorId - Connector to forecast
   * @param workspaceId - Workspace scope
   * @returns Failure forecast with probability estimates
   */
  async forecastNextFailure(
    connectorId: string,
    workspaceId: string,
  ): Promise<Result<FailureForecast, ReliabilityError>> {
    try {
      const rows = await this.sql<{
        hour: Date;
        error_rate: number;
      }[]>`
        SELECT
          DATE_TRUNC('hour', succeeded_at) AS hour,
          (COUNT(*) FILTER (WHERE error_code IS NOT NULL)::FLOAT /
           NULLIF(COUNT(*), 0)) AS error_rate
        FROM sync_outcomes
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND succeeded_at >= NOW() - INTERVAL '30 days'
        GROUP BY hour
        ORDER BY hour ASC
      `;

      if (rows.length === 0) {
        return ok({
          connectorId,
          likelihood1h: 0,
          likelihood24h: 0,
          likelihood7d: 0,
          smoothedErrorRate: 0,
        });
      }

      const alpha = 0.3;
      let smoothed = rows[0]!.error_rate ?? 0;
      for (let i = 1; i < rows.length; i++) {
        smoothed = alpha * (rows[i]!.error_rate ?? 0) + (1 - alpha) * smoothed;
      }

      // Project probability of at least one failure using geometric model
      const hourlyFailureProb = Math.min(smoothed * 1.5, 1);
      const likelihood1h = hourlyFailureProb;
      const likelihood24h = Math.min(1 - Math.pow(1 - hourlyFailureProb, 24), 1);
      const likelihood7d = Math.min(1 - Math.pow(1 - hourlyFailureProb, 168), 1);

      return ok({
        connectorId,
        likelihood1h: Math.round(likelihood1h * 10000) / 100,
        likelihood24h: Math.round(likelihood24h * 10000) / 100,
        likelihood7d: Math.round(likelihood7d * 10000) / 100,
        smoothedErrorRate: Math.round(smoothed * 10000) / 100,
      });
    } catch (e) {
      log.error('Failed to forecast failure', { connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Emits a proactive alert when reliability score drops or failure forecast is high.
   * @param connectorId - Connector triggering the alert
   * @param workspaceId - Workspace scope
   * @param alertType - Alert severity category
   * @param reason - Human-readable reason
   * @param scoreAtAlert - Current score when alert was triggered
   * @returns Created alert record
   */
  async emitProactiveAlert(
    connectorId: string,
    workspaceId: string,
    alertType: ProactiveAlert['alertType'],
    reason: string,
    scoreAtAlert: number | null = null,
  ): Promise<Result<ProactiveAlert, ReliabilityError>> {
    try {
      const suppressed = await this.isAlertSuppressed(connectorId, workspaceId, alertType);
      if (suppressed) {
        log.debug('Alert suppressed', { connectorId, alertType });
        return ok({ connectorId, alertType, reason, scoreAtAlert });
      }

      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
      await this.sql`
        INSERT INTO reliability_alerts
          (connector_id, workspace_id, alert_type, reason, score_at_alert, expires_at)
        VALUES
          (${connectorId}, ${workspaceId}, ${alertType}, ${reason}, ${scoreAtAlert}, ${expiresAt})
      `;

      log.warn('Proactive alert emitted', { connectorId, alertType, reason });
      return ok({ connectorId, alertType, reason, scoreAtAlert });
    } catch (e) {
      log.error('Failed to emit alert', { connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Generates mitigation suggestions based on current reliability signals.
   * @param connectorId - Connector to assess
   * @param workspaceId - Workspace scope
   * @returns Ordered list of recommended actions
   */
  async suggestMitigations(
    connectorId: string,
    workspaceId: string,
  ): Promise<Result<MitigationSuggestion[], ReliabilityError>> {
    try {
      const [scoreResult, patternResult, forecastResult] = await Promise.all([
        this.computeReliabilityScore(connectorId, workspaceId),
        this.detectDegradationPattern(connectorId, workspaceId),
        this.forecastNextFailure(connectorId, workspaceId),
      ]);

      const suggestions: MitigationSuggestion[] = [];

      if (patternResult.isOk() && patternResult.value.authFailures > 5) {
        suggestions.push({
          action: 'Refresh OAuth credentials or API key for connector',
          priority: 'high',
          rationale: `${patternResult.value.authFailures} auth failures detected`,
        });
      }

      if (scoreResult.isOk() && scoreResult.value.errorRate > 0.2) {
        suggestions.push({
          action: 'Reduce sync frequency to give API time to recover',
          priority: 'high',
          rationale: `Error rate ${(scoreResult.value.errorRate * 100).toFixed(1)}% exceeds 20%`,
        });
      }

      if (scoreResult.isOk() && scoreResult.value.latencyP95Ms > 5000) {
        suggestions.push({
          action: 'Reduce concurrency or batch size to lower API load',
          priority: 'medium',
          rationale: `Latency p95 ${scoreResult.value.latencyP95Ms}ms suggests API overload`,
        });
      }

      if (forecastResult.isOk() && forecastResult.value.likelihood24h > 70) {
        suggestions.push({
          action: 'Enable fallback connector or last-known-good cache',
          priority: 'medium',
          rationale: `${forecastResult.value.likelihood24h}% failure probability in next 24h`,
        });
      }

      if (scoreResult.isOk() && scoreResult.value.schemaStability < 0.7) {
        suggestions.push({
          action: 'Trigger manual schema refresh and reindex affected entity types',
          priority: 'low',
          rationale: 'Schema stability below 70% — schema changes may be causing mapping errors',
        });
      }

      if (suggestions.length === 0) {
        suggestions.push({
          action: 'No immediate action required — monitor for continued degradation',
          priority: 'low',
          rationale: 'Reliability signals within acceptable range',
        });
      }

      return ok(suggestions);
    } catch (e) {
      log.error('Failed to suggest mitigations', { connectorId, error: e });
      return err({ code: 'INTERNAL_ERROR', message: String(e) });
    }
  }

  /**
   * Lists recent alerts for a connector.
   * @param connectorId - Connector ID
   * @param workspaceId - Workspace scope
   * @param limit - Max results
   * @returns Array of recent alerts
   */
  async listAlerts(
    connectorId: string,
    workspaceId: string,
    limit = 20,
  ): Promise<Result<{ id: number; alertType: string; reason: string; createdAt: Date; suppressed: boolean; acknowledged: boolean }[], ReliabilityError>> {
    try {
      const rows = await this.sql<{
        id: number;
        alert_type: string;
        reason: string;
        created_at: Date;
        suppressed: boolean;
        acknowledged: boolean;
      }[]>`
        SELECT id, alert_type, reason, created_at, suppressed, acknowledged
        FROM reliability_alerts
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

      return ok(
        rows.map((r) => ({
          id: r.id,
          alertType: r.alert_type,
          reason: r.reason,
          createdAt: r.created_at,
          suppressed: r.suppressed,
          acknowledged: r.acknowledged,
        })),
      );
    } catch (e) {
      log.error('Failed to list alerts', { connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Suppresses an alert type for a connector for a specified duration.
   * @param connectorId - Connector to suppress alerts for
   * @param workspaceId - Workspace scope
   * @param alertType - Alert type to suppress
   * @param suppressedBy - User ID who triggered suppression
   * @param durationMs - How long to suppress (default: 24h)
   * @param reason - Optional explanation
   */
  async suppressAlert(
    connectorId: string,
    workspaceId: string,
    alertType: string,
    suppressedBy: string,
    durationMs = 86_400_000,
    reason?: string,
  ): Promise<Result<void, ReliabilityError>> {
    try {
      const expiresAt = new Date(Date.now() + durationMs);
      await this.sql`
        INSERT INTO alert_suppressions
          (connector_id, workspace_id, alert_type, suppressed_by, expires_at, reason)
        VALUES
          (${connectorId}, ${workspaceId}, ${alertType}, ${suppressedBy}, ${expiresAt}, ${reason ?? null})
        ON CONFLICT (connector_id, workspace_id, alert_type) DO UPDATE SET
          suppressed_by = EXCLUDED.suppressed_by,
          expires_at    = EXCLUDED.expires_at,
          reason        = EXCLUDED.reason,
          created_at    = NOW()
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to suppress alert', { connectorId, alertType, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Runs the full reliability assessment cycle and emits alerts if thresholds breached.
   * @param connectorId - Connector to assess
   * @param workspaceId - Workspace scope
   * @returns Emitted alerts
   */
  async runAssessmentCycle(
    connectorId: string,
    workspaceId: string,
  ): Promise<Result<ProactiveAlert[], ReliabilityError>> {
    const [scoreResult, patternResult, forecastResult] = await Promise.all([
      this.computeReliabilityScore(connectorId, workspaceId),
      this.detectDegradationPattern(connectorId, workspaceId),
      this.forecastNextFailure(connectorId, workspaceId),
    ]);

    const alerts: ProactiveAlert[] = [];

    if (scoreResult.isOk()) {
      const { score } = scoreResult.value;
      if (score < CRITICAL_SCORE_THRESHOLD) {
        const r = await this.emitProactiveAlert(
          connectorId, workspaceId, 'critical',
          `Reliability score ${score} is below critical threshold (${CRITICAL_SCORE_THRESHOLD})`,
          score,
        );
        if (r.isOk()) alerts.push(r.value);
      } else if (score < WARNING_SCORE_THRESHOLD) {
        const r = await this.emitProactiveAlert(
          connectorId, workspaceId, 'warning',
          `Reliability score ${score} is below warning threshold (${WARNING_SCORE_THRESHOLD})`,
          score,
        );
        if (r.isOk()) alerts.push(r.value);
      }
    }

    if (patternResult.isOk() && patternResult.value.anomalyDetected) {
      const { dominantSignal } = patternResult.value;
      const r = await this.emitProactiveAlert(
        connectorId, workspaceId, 'anomaly',
        `Statistical anomaly detected: ${dominantSignal ?? 'unknown signal'}`,
        scoreResult.isOk() ? scoreResult.value.score : null,
      );
      if (r.isOk()) alerts.push(r.value);
    }

    if (forecastResult.isOk() && forecastResult.value.likelihood24h > FORECAST_CRITICAL_THRESHOLD * 100) {
      const r = await this.emitProactiveAlert(
        connectorId, workspaceId, 'forecast',
        `High failure probability: ${forecastResult.value.likelihood24h}% in next 24h`,
        scoreResult.isOk() ? scoreResult.value.score : null,
      );
      if (r.isOk()) alerts.push(r.value);
    }

    return ok(alerts);
  }

  private async persistScore(
    connectorId: string,
    workspaceId: string,
    s: ReliabilityScore,
    windowMs: number,
  ): Promise<void> {
    try {
      await this.sql`
        INSERT INTO reliability_scores
          (connector_id, workspace_id, score, success_rate, latency_p95_ms, error_rate, schema_stability, computed_at, window_ms)
        VALUES
          (${connectorId}, ${workspaceId}, ${s.score}, ${s.successRate}, ${s.latencyP95Ms},
           ${s.errorRate}, ${s.schemaStability}, ${s.computedAt}, ${windowMs})
      `;
    } catch (e) {
      log.warn('Failed to persist reliability score', { connectorId, error: e });
    }
  }

  private async isAlertSuppressed(
    connectorId: string,
    workspaceId: string,
    alertType: string,
  ): Promise<boolean> {
    const rows = await this.sql<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count
      FROM alert_suppressions
      WHERE connector_id = ${connectorId}
        AND workspace_id = ${workspaceId}
        AND alert_type = ${alertType}
        AND expires_at > NOW()
    `;
    return (rows[0]?.count ?? 0) > 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Computes the Z-score of the most recent value in a series against the series mean.
 * @param values - Numeric time series (most recent first)
 * @returns Z-score of first element
 */
function computeZScore(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return ((values[0] ?? 0) - mean) / stdDev;
}
