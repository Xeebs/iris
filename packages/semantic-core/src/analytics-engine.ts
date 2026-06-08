import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'analytics-engine' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricEvent = {
  id: string;
  name: string;
  value: number;
  dimensions: Record<string, string>;
  workspaceId: string;
  timestamp: Date;
};

export type AggregateWindow = '1h' | '1d' | '1w';

export type MetricAggregate = {
  metricName: string;
  window: AggregateWindow;
  dimensions: Record<string, string>;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  stddev: number;
  count: number;
  computedAt: Date;
};

export type AnomalyResult = {
  metricName: string;
  timestamp: Date;
  value: number;
  expectedValue: number;
  zScore: number;
  isAnomaly: boolean;
};

export type DashboardTemplate = 'token-efficiency' | 'connector-health' | 'user-adoption' | 'cost-trends';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute p50, p95, p99, mean, and stddev from a sorted value array.
 * @param sortedValues - Ascending-sorted array of numbers
 */
export function computeAggregates(sortedValues: number[]): { p50: number; p95: number; p99: number; mean: number; stddev: number } {
  if (sortedValues.length === 0) return { p50: 0, p95: 0, p99: 0, mean: 0, stddev: 0 };
  const n = sortedValues.length;
  const percentile = (p: number) => sortedValues[Math.min(Math.floor(n * p / 100), n - 1)]!;
  const mean = sortedValues.reduce((s, v) => s + v, 0) / n;
  const variance = sortedValues.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    mean,
    stddev: Math.sqrt(variance),
  };
}

/**
 * Compute exponential moving average for anomaly detection.
 * Alpha controls smoothing: higher alpha = more reactive, lower = smoother.
 * @param values - Ordered time-series values
 * @param alpha - Smoothing factor (0 < alpha < 1), default 0.3
 */
export function exponentialMovingAverage(values: number[], alpha = 0.3): number[] {
  if (values.length === 0) return [];
  const ema: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    ema.push(alpha * values[i]! + (1 - alpha) * ema[i - 1]!);
  }
  return ema;
}

/**
 * Detect anomalies using z-score against the exponential smoothed baseline.
 * @param values - Ordered time-series values
 * @param threshold - Z-score threshold for anomaly (default: 2.5)
 */
export function detectAnomalies(values: number[], threshold = 2.5): AnomalyResult[] {
  if (values.length < 3) return [];
  const ema = exponentialMovingAverage(values);
  const sorted = [...values].sort((a, b) => a - b);
  const { mean, stddev } = computeAggregates(sorted);
  const safeStddev = stddev === 0 ? 1 : stddev;

  return values.map((v, i) => {
    const expected = ema[i]!;
    const zScore = Math.abs(v - mean) / safeStddev;
    return {
      metricName: '',
      timestamp: new Date(),
      value: v,
      expectedValue: expected,
      zScore,
      isAnomaly: zScore > threshold,
    };
  });
}

/**
 * Determine the rollup bucket name for a given timestamp.
 * @param ts - Timestamp to bucket
 * @param window - Aggregation window
 */
export function bucketTimestamp(ts: Date, window: AggregateWindow): string {
  const d = new Date(ts);
  if (window === '1h') {
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  }
  if (window === '1d') {
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  // 1w — ISO week (Monday)
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Build a pre-computed analytics dashboard view from aggregated metrics.
 * @param template - Dashboard template name
 * @param aggregates - Aggregated metric data
 */
export function buildDashboardView(
  template: DashboardTemplate,
  aggregates: MetricAggregate[],
): Record<string, unknown> {
  switch (template) {
    case 'token-efficiency':
      return {
        template,
        avgTokenSavedPct: aggregates
          .filter((a) => a.metricName === 'tokens_saved')
          .reduce((s, a) => s + a.mean, 0) / Math.max(aggregates.length, 1),
        aggregates: aggregates.filter((a) => a.metricName === 'tokens_saved'),
      };
    case 'connector-health':
      return {
        template,
        connectorErrors: aggregates.filter((a) => a.metricName === 'connector_error'),
        avgErrorRate: aggregates
          .filter((a) => a.metricName === 'connector_error')
          .reduce((s, a) => s + a.mean, 0) / Math.max(aggregates.length, 1),
      };
    case 'user-adoption':
      return {
        template,
        queryVolume: aggregates.filter((a) => a.metricName === 'query_latency').map((a) => ({ count: a.count, window: a.window })),
        totalQueries: aggregates.filter((a) => a.metricName === 'query_latency').reduce((s, a) => s + a.count, 0),
      };
    case 'cost-trends':
      return {
        template,
        tokenCosts: aggregates.filter((a) => a.metricName === 'tokens_used'),
        cacheHits: aggregates.filter((a) => a.metricName === 'cache_hit'),
      };
  }
}

// ─── AnalyticsService ─────────────────────────────────────────────────────────

export class AnalyticsService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Record a metric event.
   */
  async recordMetricEvent(
    name: string,
    value: number,
    dimensions: Record<string, string>,
    workspaceId: string,
    timestamp: Date = new Date(),
  ): Promise<Result<MetricEvent, Error>> {
    const id = randomUUID();
    try {
      await this.sql`
        INSERT INTO metric_events (id, name, value, dimensions, workspace_id, timestamp)
        VALUES (${id}, ${name}, ${value}, ${JSON.stringify(dimensions)}, ${workspaceId}, ${timestamp})
      `;
      log.debug('Metric event recorded', { name, value, workspaceId });
      return ok({ id, name, value, dimensions, workspaceId, timestamp });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Aggregate metrics for a given name and window.
   */
  async aggregateMetrics(
    metricName: string,
    window: AggregateWindow,
    workspaceId: string,
  ): Promise<Result<MetricAggregate, Error>> {
    const windowMs = window === '1h' ? 3_600_000 : window === '1d' ? 86_400_000 : 604_800_000;
    const since = new Date(Date.now() - windowMs);

    try {
      type Row = { value: number };
      const rows = await this.sql<Row[]>`
        SELECT value FROM metric_events
        WHERE name = ${metricName} AND workspace_id = ${workspaceId} AND timestamp >= ${since}
        ORDER BY value ASC
      `;
      const sorted = rows.map((r) => r.value);
      const agg = computeAggregates(sorted);

      return ok({
        metricName,
        window,
        dimensions: { workspaceId },
        ...agg,
        count: sorted.length,
        computedAt: new Date(),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Detect anomalies in recent metric events.
   */
  async detectMetricAnomalies(
    metricName: string,
    workspaceId: string,
    hours = 24,
    threshold = 2.5,
  ): Promise<Result<AnomalyResult[], Error>> {
    const since = new Date(Date.now() - hours * 3_600_000);
    try {
      type Row = { value: number; timestamp: Date };
      const rows = await this.sql<Row[]>`
        SELECT value, timestamp FROM metric_events
        WHERE name = ${metricName} AND workspace_id = ${workspaceId} AND timestamp >= ${since}
        ORDER BY timestamp ASC
      `;
      const values = rows.map((r) => r.value);
      const results = detectAnomalies(values, threshold);
      results.forEach((r, i) => {
        r.metricName = metricName;
        r.timestamp = rows[i]?.timestamp ?? new Date();
      });
      return ok(results);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Downsample hourly data into daily aggregates (rollup policy).
   */
  async rollupOldData(): Promise<Result<number, Error>> {
    const cutoff = new Date(Date.now() - 7 * 24 * 3_600_000);
    try {
      type Row = { name: string; workspace_id: string; value: number };
      const rows = await this.sql<Row[]>`
        SELECT name, workspace_id, value FROM metric_events
        WHERE timestamp < ${cutoff}
      `;

      if (rows.length === 0) return ok(0);

      // Group by name + workspace and write aggregate
      const groups = new Map<string, number[]>();
      for (const row of rows) {
        const key = `${row.name}::${row.workspace_id}`;
        const arr = groups.get(key) ?? [];
        arr.push(row.value);
        groups.set(key, arr);
      }

      for (const [key, values] of groups) {
        const [name, workspaceId] = key.split('::');
        const sorted = [...values].sort((a, b) => a - b);
        const { p50, p95, p99, mean, stddev } = computeAggregates(sorted);
        await this.sql`
          INSERT INTO metric_aggregates_daily (id, name, workspace_id, p50, p95, p99, mean, stddev, sample_count, aggregated_at)
          VALUES (${randomUUID()}, ${name}, ${workspaceId}, ${p50}, ${p95}, ${p99}, ${mean}, ${stddev}, ${values.length}, NOW())
          ON CONFLICT DO NOTHING
        `;
      }

      // Prune the raw events
      await this.sql`DELETE FROM metric_events WHERE timestamp < ${cutoff}`;
      log.info('Rollup complete', { groups: groups.size, events: rows.length });
      return ok(rows.length);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get a pre-computed dashboard view.
   */
  async getDashboard(
    template: DashboardTemplate,
    workspaceId: string,
    window: AggregateWindow = '1d',
  ): Promise<Result<Record<string, unknown>, Error>> {
    const metrics = ['tokens_saved', 'connector_error', 'query_latency', 'cache_hit', 'tokens_used'];
    try {
      const aggregates: MetricAggregate[] = [];
      for (const metric of metrics) {
        const r = await this.aggregateMetrics(metric, window, workspaceId);
        if (r.isOk() && r.value.count > 0) aggregates.push(r.value);
      }
      return ok(buildDashboardView(template, aggregates));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
