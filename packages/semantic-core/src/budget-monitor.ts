import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'budget-monitor' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type BudgetSeverity = 'info' | 'warning' | 'critical';

export type BudgetUsageEvent = {
  workspaceId: string;
  queryId: string;
  tokensConsumed: number;
  contextSize: number;
  provider: string;
  timestamp: Date;
};

export type BudgetUtilization = {
  workspaceId: string;
  monthlyBudget: number;
  tokensUsed: number;
  utilizationPct: number;
  remainingTokens: number;
  timeWindowDays: number;
};

export type BudgetAnomaly = {
  workspaceId: string;
  type: 'spike' | 'sustained_high' | 'unusual_distribution';
  description: string;
  zScore: number;
  detectedAt: Date;
};

export type BudgetAdjustment = {
  workspaceId: string;
  currentBudget: number;
  recommendedBudget: number;
  basis: string;
  avgDailyTokens: number;
};

export type BudgetAlert = {
  workspaceId: string;
  thresholdPct: number;
  severity: BudgetSeverity;
  triggeredAt: Date;
  acknowledgedAt: Date | null;
  notificationChannels: string[];
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute mean of a number array.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compute population standard deviation.
 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute Z-score of a value relative to a distribution.
 */
export function zScore(value: number, population: number[]): number {
  const sd = stdDev(population);
  if (sd === 0) return 0;
  return (value - mean(population)) / sd;
}

/**
 * Map utilization % to severity level.
 */
export function utilizationToSeverity(pct: number): BudgetSeverity {
  if (pct >= 100) return 'critical';
  if (pct >= 75) return 'warning';
  return 'info';
}

/**
 * Determine alert threshold buckets crossed by a new utilization pct.
 * Returns each threshold crossed by the move from prevPct → newPct.
 */
export function alertThresholdsCrossed(prevPct: number, newPct: number, thresholds: number[]): number[] {
  return thresholds.filter((t) => prevPct < t && newPct >= t);
}

// ─── BudgetMonitor class ──────────────────────────────────────────────────────

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export class BudgetMonitor {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Record a query's token consumption against the workspace budget.
   */
  async trackQueryBudget(event: BudgetUsageEvent): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO budget_usage_events
          (workspace_id, query_id, tokens_consumed, context_size, provider, timestamp)
        VALUES
          (${event.workspaceId}, ${event.queryId}, ${event.tokensConsumed}, ${event.contextSize}, ${event.provider}, ${event.timestamp.toISOString()})
        ON CONFLICT (workspace_id, query_id) DO NOTHING
      `;
      log.debug('Budget event tracked', { workspaceId: event.workspaceId, queryId: event.queryId, tokensConsumed: event.tokensConsumed });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compute current token utilization for a workspace within a rolling time window.
   */
  async computeBudgetUtilization(
    workspaceId: string,
    timeWindowDays = 30,
  ): Promise<Result<BudgetUtilization, Error>> {
    try {
      const [budgetRow] = await this.sql`
        SELECT monthly_token_budget, rolling_window_days
        FROM workspace_budgets
        WHERE workspace_id = ${workspaceId}
        LIMIT 1
      ` as Array<{ monthly_token_budget: number; rolling_window_days: number }>;

      const monthlyBudget = budgetRow?.monthly_token_budget ?? 1_000_000;
      const windowDays = budgetRow?.rolling_window_days ?? timeWindowDays;

      const [usageRow] = await this.sql`
        SELECT COALESCE(SUM(tokens_consumed), 0)::int AS total_tokens
        FROM budget_usage_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= NOW() - (${windowDays} * INTERVAL '1 day')
      ` as Array<{ total_tokens: number }>;

      const tokensUsed = usageRow?.total_tokens ?? 0;
      const utilizationPct = monthlyBudget > 0 ? Math.round((tokensUsed / monthlyBudget) * 100) : 0;

      return ok({
        workspaceId,
        monthlyBudget,
        tokensUsed,
        utilizationPct,
        remainingTokens: Math.max(0, monthlyBudget - tokensUsed),
        timeWindowDays: windowDays,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Use Z-score analysis to detect abnormal query token patterns.
   */
  async detectBudgetAnomalies(workspaceId: string): Promise<Result<BudgetAnomaly[], Error>> {
    try {
      const rows = await this.sql`
        SELECT
          DATE_TRUNC('day', timestamp) AS day,
          SUM(tokens_consumed)::int AS daily_tokens
        FROM budget_usage_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1
      ` as Array<{ day: string; daily_tokens: number }>;

      if (rows.length < 3) return ok([]);

      const dailyValues = rows.map((r) => r.daily_tokens);
      const lastDay = dailyValues[dailyValues.length - 1]!;
      const z = zScore(lastDay, dailyValues);
      const anomalies: BudgetAnomaly[] = [];

      if (z > 2.5) {
        anomalies.push({
          workspaceId,
          type: 'spike',
          description: `Token usage today (${lastDay.toLocaleString()}) is ${z.toFixed(1)}σ above the 30-day mean.`,
          zScore: Math.round(z * 100) / 100,
          detectedAt: new Date(),
        });
      }

      const recentSlice = dailyValues.slice(-7);
      const historicMean = mean(dailyValues.slice(0, -7));
      if (historicMean > 0 && mean(recentSlice) > historicMean * 1.5) {
        anomalies.push({
          workspaceId,
          type: 'sustained_high',
          description: `7-day rolling average is ${((mean(recentSlice) / historicMean - 1) * 100).toFixed(0)}% above historical baseline.`,
          zScore: zScore(mean(recentSlice), dailyValues),
          detectedAt: new Date(),
        });
      }

      log.info('Anomaly detection complete', { workspaceId, count: anomalies.length });
      return ok(anomalies);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Recommend a new budget level based on 7-day average plus 20% headroom.
   */
  async suggestBudgetAdjustments(workspaceId: string): Promise<Result<BudgetAdjustment, Error>> {
    try {
      const [row] = await this.sql`
        SELECT
          monthly_token_budget AS current_budget,
          (
            SELECT COALESCE(AVG(daily_tokens)::int, 0)
            FROM (
              SELECT SUM(tokens_consumed)::int AS daily_tokens
              FROM budget_usage_events
              WHERE workspace_id = ${workspaceId}
                AND timestamp >= NOW() - INTERVAL '7 days'
              GROUP BY DATE_TRUNC('day', timestamp)
            ) d
          ) AS avg_daily_tokens
        FROM workspace_budgets
        WHERE workspace_id = ${workspaceId}
        LIMIT 1
      ` as Array<{ current_budget: number; avg_daily_tokens: number }>;

      const currentBudget = row?.current_budget ?? 1_000_000;
      const avgDailyTokens = row?.avg_daily_tokens ?? 0;
      const projected30Day = avgDailyTokens * 30;
      const recommendedBudget = Math.ceil(projected30Day * 1.2);

      return ok({
        workspaceId,
        currentBudget,
        recommendedBudget,
        basis: `Based on 7-day daily average of ${avgDailyTokens.toLocaleString()} tokens × 30 days + 20% headroom.`,
        avgDailyTokens,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Emit a budget alert record when a utilization threshold is crossed.
   */
  async emitBudgetAlert(
    workspaceId: string,
    thresholdPct: number,
    notificationChannels: string[],
  ): Promise<Result<BudgetAlert, Error>> {
    try {
      const severity = utilizationToSeverity(thresholdPct);

      await this.sql`
        INSERT INTO budget_alerts
          (workspace_id, threshold_pct, triggered_at, notification_channels_used)
        VALUES
          (${workspaceId}, ${thresholdPct}, NOW(), ${JSON.stringify(notificationChannels)}::jsonb)
        ON CONFLICT DO NOTHING
      `;

      log.warn('Budget alert emitted', { workspaceId, thresholdPct, severity });

      return ok({
        workspaceId,
        thresholdPct,
        severity,
        triggeredAt: new Date(),
        acknowledgedAt: null,
        notificationChannels,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve recent active budget alerts for a workspace.
   */
  async getActiveAlerts(workspaceId: string): Promise<Result<BudgetAlert[], Error>> {
    try {
      const rows = await this.sql`
        SELECT threshold_pct, triggered_at, acknowledged_at, notification_channels_used
        FROM budget_alerts
        WHERE workspace_id = ${workspaceId}
          AND acknowledged_at IS NULL
        ORDER BY triggered_at DESC
        LIMIT 20
      ` as Array<{
        threshold_pct: number;
        triggered_at: string;
        acknowledged_at: string | null;
        notification_channels_used: string;
      }>;

      return ok(
        rows.map((r) => ({
          workspaceId,
          thresholdPct: r.threshold_pct,
          severity: utilizationToSeverity(r.threshold_pct),
          triggeredAt: new Date(r.triggered_at),
          acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at) : null,
          notificationChannels: JSON.parse(r.notification_channels_used) as string[],
        })),
      );
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
