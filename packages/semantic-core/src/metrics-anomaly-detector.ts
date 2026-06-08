import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'metrics-anomaly-detector' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnomalySeverity = 'low' | 'medium' | 'high';

export type SensitivityLevel = 'low' | 'medium' | 'high';

const SENSITIVITY_Z_SCORES: Record<SensitivityLevel, number> = {
  low: 3.0,
  medium: 2.0,
  high: 1.5,
};

export type MetricAnomaly = {
  anomalyId: string | undefined;
  metricId: string;
  anomalyDate: Date;
  observedValue: number;
  expectedValue: number;
  zScore: number;
  severity: AnomalySeverity;
  detectedAt: Date;
  acknowledgedAt: Date | undefined;
  notes: string | undefined;
};

export type ForecastPoint = {
  date: Date;
  forecastedValue: number;
  trend: 'up' | 'down' | 'stable';
};

export type AnomalyContext = {
  metricId: string;
  anomalyTimestamp: Date;
  nearbyLineageEvents: {
    entityId: string;
    eventType: string;
    occurredAt: Date;
    description: string | undefined;
  }[];
};

// ─── Stats helpers ────────────────────────────────────────────────────────────

/**
 * Compute mean and standard deviation of an array of numbers.
 * Returns { mean: 0, stdDev: 0 } for empty or single-element arrays.
 */
export function computeStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  if (values.length === 1) return { mean: values[0]!, stdDev: 0 };

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Z-score of a value given mean and standard deviation.
 * Returns 0 when stdDev is 0 (zero variance dataset).
 */
export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return Math.abs((value - mean) / stdDev);
}

function zScoreToSeverity(z: number, threshold: number): AnomalySeverity {
  if (z >= threshold * 2) return 'high';
  if (z >= threshold * 1.5) return 'medium';
  return 'low';
}

/**
 * Exponential smoothing (Brown's simple exponential smoothing).
 * alpha: smoothing factor in (0, 1). Higher → more weight on recent values.
 */
export function exponentialSmoothing(values: number[], alpha: number): number[] {
  if (values.length === 0) return [];
  const smoothed = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    smoothed.push(alpha * values[i]! + (1 - alpha) * smoothed[i - 1]!);
  }
  return smoothed;
}

/**
 * Forecast `daysAhead` future values using exponential smoothing.
 * The last smoothed value is extrapolated linearly from the trend of the last two points.
 */
export function forecastValues(
  historicalValues: number[],
  daysAhead: number,
  alpha = 0.3
): number[] {
  if (historicalValues.length === 0) return Array(daysAhead).fill(0) as number[];

  const smoothed = exponentialSmoothing(historicalValues, alpha);
  const lastSmoothed = smoothed[smoothed.length - 1]!;
  const prevSmoothed = smoothed.length >= 2 ? smoothed[smoothed.length - 2]! : lastSmoothed;
  const trend = lastSmoothed - prevSmoothed;

  return Array.from({ length: daysAhead }, (_, i) => lastSmoothed + trend * (i + 1));
}

// ─── MetricsAnomalyDetector ───────────────────────────────────────────────────

/**
 * Detects anomalies and forecasts metric values using statistical methods.
 * Anomalies are persisted to metric_anomalies for dashboard surfacing.
 */
export class MetricsAnomalyDetector {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Detect anomalies in a metric's historical values using Z-score analysis.
   *
   * @param metricId - Metric to analyze
   * @param lookbackDays - Number of historical days to include (default 30)
   * @param sensitivityLevel - Detection threshold: 'low'|'medium'|'high' (default 'medium')
   * @returns Array of detected anomalies
   */
  async detectAnomalies(
    metricId: string,
    lookbackDays = 30,
    sensitivityLevel: SensitivityLevel = 'medium'
  ): Promise<Result<MetricAnomaly[], Error>> {
    const threshold = SENSITIVITY_Z_SCORES[sensitivityLevel];

    try {
      const rows = await this.sql`
        SELECT recorded_at, value
        FROM metric_values
        WHERE metric_id = ${metricId}
          AND recorded_at >= now() - INTERVAL '1 day' * ${lookbackDays}
        ORDER BY recorded_at ASC
      ` as { recorded_at: string; value: number }[];

      if (rows.length < 3) {
        return ok([]);
      }

      const values = rows.map(r => r.value);
      const { mean, stdDev } = computeStats(values);

      const anomalies: MetricAnomaly[] = [];
      const now = new Date();

      for (const row of rows) {
        const z = zScore(row.value, mean, stdDev);
        if (z < threshold) continue;

        const severity = zScoreToSeverity(z, threshold);
        const anomalyDate = new Date(row.recorded_at);

        try {
          const inserted = await this.sql`
            INSERT INTO metric_anomalies
              (metric_id, anomaly_date, observed_value, expected_value, z_score, severity, detected_at)
            VALUES
              (${metricId}, ${anomalyDate}, ${row.value}, ${mean}, ${z}, ${severity}, ${now})
            ON CONFLICT (metric_id, anomaly_date) DO UPDATE
              SET z_score = EXCLUDED.z_score, severity = EXCLUDED.severity
            RETURNING anomaly_id
          ` as { anomaly_id: string }[];

          anomalies.push({
            anomalyId: inserted[0]?.anomaly_id,
            metricId,
            anomalyDate,
            observedValue: row.value,
            expectedValue: mean,
            zScore: z,
            severity,
            detectedAt: now,
            acknowledgedAt: undefined,
            notes: undefined,
          });
        } catch (persistErr) {
          log.warn('Failed to persist anomaly', { metricId, error: String(persistErr) });
          anomalies.push({
            anomalyId: undefined,
            metricId,
            anomalyDate,
            observedValue: row.value,
            expectedValue: mean,
            zScore: z,
            severity,
            detectedAt: now,
            acknowledgedAt: undefined,
            notes: undefined,
          });
        }
      }

      log.info('Anomaly detection complete', {
        metricId,
        lookbackDays,
        sensitivityLevel,
        dataPoints: rows.length,
        anomaliesFound: anomalies.length,
      });

      return ok(anomalies);
    } catch (e) {
      log.error('Anomaly detection failed', { metricId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Forecast a metric's future values using exponential smoothing.
   *
   * @param metricId - Metric to forecast
   * @param daysAhead - Number of days to forecast (default 7)
   * @param alpha - Smoothing factor (default 0.3)
   * @returns Array of forecast points with trend direction
   */
  async forecastMetricValue(
    metricId: string,
    daysAhead = 7,
    alpha = 0.3
  ): Promise<Result<ForecastPoint[], Error>> {
    try {
      const rows = await this.sql`
        SELECT recorded_at, value
        FROM metric_values
        WHERE metric_id = ${metricId}
          AND recorded_at >= now() - INTERVAL '30 days'
        ORDER BY recorded_at ASC
      ` as { recorded_at: string; value: number }[];

      if (rows.length === 0) {
        return ok([]);
      }

      const values = rows.map(r => r.value);
      const forecasted = forecastValues(values, daysAhead, alpha);
      const lastDate = new Date(rows[rows.length - 1]!.recorded_at);
      const lastValue = values[values.length - 1]!;

      const points: ForecastPoint[] = forecasted.map((v, i) => {
        const date = new Date(lastDate);
        date.setDate(date.getDate() + i + 1);
        const trend: ForecastPoint['trend'] =
          Math.abs(v - lastValue) < lastValue * 0.01
            ? 'stable'
            : v > lastValue
              ? 'up'
              : 'down';
        return { date, forecastedValue: Math.round(v * 100) / 100, trend };
      });

      return ok(points);
    } catch (e) {
      log.error('Forecast failed', { metricId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve contextual entities (from lineage events) that changed around an anomaly timestamp.
   * This surfaces "what changed around the time of the anomaly" for investigation.
   *
   * @param metricId - Metric that had the anomaly
   * @param timestamp - Anomaly timestamp
   * @param windowHours - Hours before/after to search (default 24)
   */
  async anomalyContext(
    metricId: string,
    timestamp: Date,
    windowHours = 24
  ): Promise<Result<AnomalyContext, Error>> {
    try {
      const rows = await this.sql`
        SELECT entity_id, event_type, occurred_at, description
        FROM lineage_events
        WHERE occurred_at BETWEEN
          ${timestamp}::timestamptz - INTERVAL '1 hour' * ${windowHours} AND
          ${timestamp}::timestamptz + INTERVAL '1 hour' * ${windowHours}
        ORDER BY occurred_at DESC
        LIMIT 20
      ` as { entity_id: string; event_type: string; occurred_at: string; description: string | null }[];

      return ok({
        metricId,
        anomalyTimestamp: timestamp,
        nearbyLineageEvents: rows.map(r => ({
          entityId: r.entity_id,
          eventType: r.event_type,
          occurredAt: new Date(r.occurred_at),
          description: r.description ?? undefined,
        })),
      });
    } catch (e) {
      log.error('Failed to fetch anomaly context', { metricId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List stored anomalies for a metric with optional pagination.
   *
   * @param metricId - Metric to query
   * @param includeAcknowledged - Whether to include acknowledged anomalies (default false)
   * @param limit - Max results (default 50)
   */
  async listAnomalies(
    metricId: string,
    includeAcknowledged = false,
    limit = 50
  ): Promise<Result<MetricAnomaly[], Error>> {
    try {
      const rows = includeAcknowledged
        ? await this.sql`
            SELECT * FROM metric_anomalies
            WHERE metric_id = ${metricId}
            ORDER BY anomaly_date DESC
            LIMIT ${limit}
          ` as Record<string, unknown>[]
        : await this.sql`
            SELECT * FROM metric_anomalies
            WHERE metric_id = ${metricId} AND acknowledged_at IS NULL
            ORDER BY anomaly_date DESC
            LIMIT ${limit}
          ` as Record<string, unknown>[];

      return ok(rows.map(r => this.rowToAnomaly(r)));
    } catch (e) {
      log.error('Failed to list anomalies', { metricId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Acknowledge an anomaly with an optional note.
   *
   * @param anomalyId - Anomaly to acknowledge
   * @param notes - Optional investigation note
   */
  async acknowledgeAnomaly(anomalyId: string, notes?: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE metric_anomalies
        SET acknowledged_at = now(), notes = ${notes ?? null}
        WHERE anomaly_id = ${anomalyId}
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to acknowledge anomaly', { anomalyId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private rowToAnomaly(r: Record<string, unknown>): MetricAnomaly {
    return {
      anomalyId: r['anomaly_id'] ? String(r['anomaly_id']) : undefined,
      metricId: String(r['metric_id']),
      anomalyDate: new Date(r['anomaly_date'] as string),
      observedValue: r['observed_value'] as number,
      expectedValue: r['expected_value'] as number,
      zScore: r['z_score'] as number,
      severity: r['severity'] as AnomalySeverity,
      detectedAt: new Date(r['detected_at'] as string),
      acknowledgedAt: r['acknowledged_at'] ? new Date(r['acknowledged_at'] as string) : undefined,
      notes: r['notes'] ? String(r['notes']) : undefined,
    };
  }
}
