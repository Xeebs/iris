import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ service: 'connector-health-scorer' });

export type HealthScoreBreakdown = {
  connectorId: string;
  workspaceId: string;
  overallScore: number;
  syncSuccessRate: number;
  entityFreshness: number;
  errorFrequency: number;
  authValidity: number;
  scoredAt: Date;
};

export type HealthAlert = {
  alertId: string;
  connectorId: string;
  workspaceId: string;
  alertType: 'degradation' | 'auth_expiry' | 'sync_failure' | 'stale_data';
  severity: 'warning' | 'critical';
  message: string;
  currentScore: number | null;
  baselineScore: number | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export type RecoveryAction = {
  actionId: string;
  connectorId: string;
  workspaceId: string;
  actionType: 're-auth' | 'manual-sync' | 'pause' | 'retry';
  reason: string;
  executedAt: Date | null;
  result: string | null;
};

export type RecoveryRecommendation = {
  actionType: RecoveryAction['actionType'];
  reason: string;
  priority: number;
};

/**
 * Compute composite health score (0–100) from weighted sub-scores.
 * Weights: sync success 40%, entity freshness 30%, error frequency 20%, auth validity 10%.
 * @param syncSuccessRate - Fraction 0–1
 * @param entityFreshness - Fraction 0–1
 * @param errorFrequency - Fraction 0–1 (1 = no errors)
 * @param authValidity - Fraction 0–1 (1 = valid auth)
 */
export function computeHealthScore(
  syncSuccessRate: number,
  entityFreshness: number,
  errorFrequency: number,
  authValidity: number,
): number {
  const score = syncSuccessRate * 40 + entityFreshness * 30 + errorFrequency * 20 + authValidity * 10;
  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Determine if the current score represents degradation vs a baseline.
 * @param currentScore - Current 0–100 health score
 * @param baselineScore - Rolling average to compare against
 * @returns true if score dropped >15 points from baseline
 */
export function isDegraded(currentScore: number, baselineScore: number): boolean {
  return baselineScore - currentScore > 15;
}

/**
 * Build prioritized recovery recommendations from a health breakdown.
 * @param breakdown - Current health score details
 * @returns List of recommended actions ordered by priority (highest first)
 */
export function buildRecoveryRecommendations(breakdown: HealthScoreBreakdown): RecoveryRecommendation[] {
  const recs: RecoveryRecommendation[] = [];

  if (breakdown.authValidity < 0.5) {
    recs.push({ actionType: 're-auth', reason: 'Auth validity is critically low — connector may have lost OAuth access.', priority: 100 });
  }
  if (breakdown.syncSuccessRate < 0.6) {
    recs.push({ actionType: 'retry', reason: 'Sync success rate is below 60% — transient errors may clear on retry.', priority: 80 });
  }
  if (breakdown.entityFreshness < 0.5) {
    recs.push({ actionType: 'manual-sync', reason: 'Entities are stale (freshness < 50%). Trigger a full sync to refresh.', priority: 70 });
  }
  if (breakdown.errorFrequency < 0.3) {
    recs.push({ actionType: 'pause', reason: 'Error frequency is very high — pausing prevents excessive API calls.', priority: 60 });
  }

  return recs.sort((a, b) => b.priority - a.priority);
}

/**
 * Scores connector health, detects degradation, and recommends recovery actions.
 */
export class ConnectorHealthScorer {
  private readonly sql: SqlFn;

  constructor(sql: SqlFn) {
    this.sql = sql;
  }

  /**
   * Compute and persist a health score for a connector instance.
   * @param connectorId - Connector instance ID
   * @param workspaceId - Workspace ID
   */
  async scoreConnector(connectorId: string, workspaceId: string): Promise<Result<HealthScoreBreakdown, Error>> {
    try {
      const metricsRows = await this.sql`
        SELECT
          COALESCE(AVG(CASE WHEN status = 'success' THEN 1.0 ELSE 0.0 END), 0) AS sync_success_rate,
          COALESCE(
            1.0 - (EXTRACT(EPOCH FROM (now() - MAX(completed_at))) / 86400.0 / 7.0), 0
          ) AS entity_freshness,
          COALESCE(AVG(CASE WHEN error_count = 0 THEN 1.0 ELSE GREATEST(0, 1.0 - error_count::float / 10.0) END), 0.5) AS error_frequency_score,
          COALESCE(MAX(CASE WHEN auth_valid = true THEN 1.0 ELSE 0.0 END), 0) AS auth_validity
        FROM connector_sync_runs
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND started_at > now() - INTERVAL '7 days'
      ` as unknown as Array<{
        sync_success_rate: string;
        entity_freshness: string;
        error_frequency_score: string;
        auth_validity: string;
      }>;

      const m = metricsRows[0] ?? { sync_success_rate: '0.5', entity_freshness: '0.5', error_frequency_score: '0.5', auth_validity: '1' };
      const syncSuccessRate = Math.min(1, Math.max(0, parseFloat(m.sync_success_rate)));
      const entityFreshness = Math.min(1, Math.max(0, parseFloat(m.entity_freshness)));
      const errorFrequency = Math.min(1, Math.max(0, parseFloat(m.error_frequency_score)));
      const authValidity = Math.min(1, Math.max(0, parseFloat(m.auth_validity)));

      const overallScore = computeHealthScore(syncSuccessRate, entityFreshness, errorFrequency, authValidity);

      await this.sql`
        INSERT INTO connector_health_scores
          (connector_id, workspace_id, overall_score, sync_success_rate, entity_freshness, error_frequency, auth_validity)
        VALUES
          (${connectorId}, ${workspaceId}, ${overallScore}, ${syncSuccessRate}, ${entityFreshness}, ${errorFrequency}, ${authValidity})
      `;

      const breakdown: HealthScoreBreakdown = {
        connectorId, workspaceId, overallScore,
        syncSuccessRate, entityFreshness, errorFrequency, authValidity,
        scoredAt: new Date(),
      };
      log.info('Health score recorded', { connectorId, workspaceId, overallScore });
      return ok(breakdown);
    } catch (e) {
      log.error('Failed to score connector', { connectorId, error: e instanceof Error ? e.message : e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Detect score degradation vs 7-day rolling baseline. Creates an alert if degraded.
   * @param connectorId - Connector instance ID
   * @param workspaceId - Workspace ID
   */
  async detectDegradation(connectorId: string, workspaceId: string): Promise<Result<HealthAlert | null, Error>> {
    try {
      const rows = await this.sql`
        SELECT overall_score, scored_at
        FROM connector_health_scores
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
        ORDER BY scored_at DESC
        LIMIT 14
      ` as unknown as Array<{ overall_score: number; scored_at: Date }>;

      if (rows.length < 2) return ok(null);

      const current = rows[0]!.overall_score;
      const baseline = rows.slice(1).reduce((sum, r) => sum + r.overall_score, 0) / (rows.length - 1);

      if (!isDegraded(current, baseline)) return ok(null);

      const alertRows = await this.sql`
        INSERT INTO health_alerts (connector_id, workspace_id, alert_type, severity, message, current_score, baseline_score)
        VALUES (
          ${connectorId}, ${workspaceId}, 'degradation',
          ${current < baseline - 30 ? 'critical' : 'warning'},
          ${`Health score dropped from ${Math.round(baseline)} to ${current} (>${Math.round(baseline - current)} point drop)`},
          ${current}, ${Math.round(baseline)}
        )
        RETURNING alert_id, connector_id, workspace_id, alert_type, severity, message, current_score, baseline_score, created_at, resolved_at
      ` as unknown as Array<{
        alert_id: string;
        connector_id: string;
        workspace_id: string;
        alert_type: string;
        severity: string;
        message: string;
        current_score: number;
        baseline_score: number;
        created_at: Date;
        resolved_at: Date | null;
      }>;

      const row = alertRows[0];
      if (!row) return ok(null);
      const alert: HealthAlert = {
        alertId: row.alert_id, connectorId: row.connector_id, workspaceId: row.workspace_id,
        alertType: row.alert_type as HealthAlert['alertType'],
        severity: row.severity as HealthAlert['severity'],
        message: row.message, currentScore: row.current_score,
        baselineScore: row.baseline_score, createdAt: row.created_at, resolvedAt: row.resolved_at,
      };
      log.warn('Degradation alert created', { connectorId, current, baseline: Math.round(baseline) });
      return ok(alert);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Return recovery recommendations for a connector based on its latest health score.
   * @param connectorId - Connector instance ID
   * @param workspaceId - Workspace ID
   */
  async suggestRecovery(connectorId: string, workspaceId: string): Promise<Result<RecoveryRecommendation[], Error>> {
    try {
      const rows = await this.sql`
        SELECT overall_score, sync_success_rate, entity_freshness, error_frequency, auth_validity, scored_at
        FROM connector_health_scores
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
        ORDER BY scored_at DESC LIMIT 1
      ` as unknown as Array<{
        overall_score: number;
        sync_success_rate: number;
        entity_freshness: number;
        error_frequency: number;
        auth_validity: number;
        scored_at: Date;
      }>;

      if (rows.length === 0) return ok([]);
      const row = rows[0]!;
      const breakdown: HealthScoreBreakdown = {
        connectorId, workspaceId,
        overallScore: row.overall_score,
        syncSuccessRate: row.sync_success_rate,
        entityFreshness: row.entity_freshness,
        errorFrequency: row.error_frequency,
        authValidity: row.auth_validity,
        scoredAt: row.scored_at,
      };
      return ok(buildRecoveryRecommendations(breakdown));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Execute a recovery action and record the outcome.
   * @param connectorId - Connector instance ID
   * @param workspaceId - Workspace ID
   * @param actionType - Which recovery action to record
   */
  async executeRecoveryAction(
    connectorId: string,
    workspaceId: string,
    actionType: RecoveryAction['actionType'],
  ): Promise<Result<RecoveryAction, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO recovery_actions (connector_id, workspace_id, action_type, reason, executed_at, result)
        VALUES (${connectorId}, ${workspaceId}, ${actionType}, ${`Manual ${actionType} via health scorer`}, now(), 'initiated')
        RETURNING action_id, connector_id, workspace_id, action_type, reason, executed_at, result
      ` as unknown as Array<{
        action_id: string;
        connector_id: string;
        workspace_id: string;
        action_type: string;
        reason: string;
        executed_at: Date;
        result: string;
      }>;
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));
      log.info('Recovery action executed', { connectorId, actionType });
      return ok({
        actionId: row.action_id, connectorId: row.connector_id, workspaceId: row.workspace_id,
        actionType: row.action_type as RecoveryAction['actionType'],
        reason: row.reason, executedAt: row.executed_at, result: row.result,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve health score history for a connector.
   * @param connectorId - Connector instance ID
   * @param workspaceId - Workspace ID
   * @param days - How many days of history to fetch (default 7)
   */
  async getHealthHistory(
    connectorId: string,
    workspaceId: string,
    days = 7,
  ): Promise<Result<HealthScoreBreakdown[], Error>> {
    try {
      const rows = await this.sql`
        SELECT connector_id, workspace_id, overall_score, sync_success_rate,
               entity_freshness, error_frequency, auth_validity, scored_at
        FROM connector_health_scores
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
          AND scored_at > now() - make_interval(days => ${days})
        ORDER BY scored_at ASC
      ` as unknown as Array<{
        connector_id: string;
        workspace_id: string;
        overall_score: number;
        sync_success_rate: number;
        entity_freshness: number;
        error_frequency: number;
        auth_validity: number;
        scored_at: Date;
      }>;
      return ok(rows.map(r => ({
        connectorId: r.connector_id, workspaceId: r.workspace_id,
        overallScore: r.overall_score, syncSuccessRate: r.sync_success_rate,
        entityFreshness: r.entity_freshness, errorFrequency: r.error_frequency,
        authValidity: r.auth_validity, scoredAt: r.scored_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List active (unresolved) health alerts across a workspace.
   * @param workspaceId - Workspace ID
   */
  async listActiveAlerts(workspaceId: string): Promise<Result<HealthAlert[], Error>> {
    try {
      const rows = await this.sql`
        SELECT alert_id, connector_id, workspace_id, alert_type, severity,
               message, current_score, baseline_score, created_at, resolved_at
        FROM health_alerts
        WHERE workspace_id = ${workspaceId} AND resolved_at IS NULL
        ORDER BY created_at DESC
        LIMIT 100
      ` as unknown as Array<{
        alert_id: string;
        connector_id: string;
        workspace_id: string;
        alert_type: string;
        severity: string;
        message: string;
        current_score: number | null;
        baseline_score: number | null;
        created_at: Date;
        resolved_at: Date | null;
      }>;
      return ok(rows.map(r => ({
        alertId: r.alert_id, connectorId: r.connector_id, workspaceId: r.workspace_id,
        alertType: r.alert_type as HealthAlert['alertType'],
        severity: r.severity as HealthAlert['severity'],
        message: r.message, currentScore: r.current_score,
        baselineScore: r.baseline_score, createdAt: r.created_at, resolvedAt: r.resolved_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Resolve (dismiss) a health alert.
   * @param alertId - Alert ID to resolve
   * @param workspaceId - Workspace ID (for security validation)
   */
  async resolveAlert(alertId: string, workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE health_alerts SET resolved_at = now()
        WHERE alert_id = ${alertId} AND workspace_id = ${workspaceId} AND resolved_at IS NULL
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
