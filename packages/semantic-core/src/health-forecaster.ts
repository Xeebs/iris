import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'health-forecaster' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthMetricPoint = {
  date: Date;
  healthScore: number;
  syncLatencyMs?: number;
  errorRate?: number;
  entityThroughput?: number;
};

export type ForecastPoint = {
  date: Date;
  predictedScore: number;
  confidenceLow: number;
  confidenceHigh: number;
};

export type ForecastResult = {
  connectorId: string;
  forecastDays: number;
  forecast: ForecastPoint[];
  trend: 'improving' | 'stable' | 'degrading';
  modelType: 'exponential_smoothing';
};

export type AnomalyDetection = {
  anomalies: Array<{
    date: Date;
    actual: number;
    expected: number;
    deviationSigma: number;
  }>;
  hasAnomaly: boolean;
};

export type AlertSeverity = 'warning' | 'critical';
export type PredictedIssue = 'high_latency' | 'high_error_rate' | 'data_staleness' | 'health_decline';

export type ForecastAlert = {
  connectorId: string;
  alertSeverity: AlertSeverity;
  predictedIssue: PredictedIssue;
  daysUntilThreshold: number;
  currentScore: number;
  predictedScore: number;
  recommendedAction: string;
  createdAt: Date;
};

// ─── Exponential smoothing helpers ───────────────────────────────────────────

const WARNING_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 50;
const DEFAULT_ALPHA = 0.3; // smoothing factor
const CONFIDENCE_BAND = 10; // ±10 points

/**
 * Simple exponential smoothing (Holt single): Ŝ_t = α * y_t + (1-α) * Ŝ_{t-1}
 */
function exponentialSmooth(values: number[], alpha: number = DEFAULT_ALPHA): number[] {
  if (values.length === 0) return [];
  const smoothed: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    smoothed.push(alpha * values[i]! + (1 - alpha) * smoothed[i - 1]!);
  }
  return smoothed;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], m?: number): number {
  const mu = m ?? mean(values);
  const variance = values.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, values.length);
  return Math.sqrt(variance);
}

// ─── ConnectorHealthForecaster ────────────────────────────────────────────────

export class ConnectorHealthForecaster {
  /**
   * Fit a forecast model to historical health metrics.
   * @param metrics - Historical health data points in ascending date order
   * @param daysAhead - How many days to forecast
   * @returns ForecastResult with predicted scores and confidence intervals
   */
  forecastHealth(connectorId: string, metrics: HealthMetricPoint[], daysAhead = 7): ForecastResult {
    const scores = metrics.map((m) => Math.min(100, Math.max(0, m.healthScore)));
    const smoothed = exponentialSmooth(scores);
    const lastSmoothed = smoothed.at(-1) ?? 50;

    // Compute trend from last 7 smoothed points
    const recent = smoothed.slice(-7);
    const trendSlope = recent.length >= 2
      ? (recent.at(-1)! - recent[0]!) / (recent.length - 1)
      : 0;

    const forecast: ForecastPoint[] = [];
    const lastDate = metrics.at(-1)?.date ?? new Date();

    for (let d = 1; d <= daysAhead; d++) {
      const date = new Date(lastDate.getTime() + d * 86_400_000);
      const predicted = Math.min(100, Math.max(0, lastSmoothed + trendSlope * d));
      forecast.push({
        date,
        predictedScore: Math.round(predicted * 10) / 10,
        confidenceLow: Math.max(0, Math.round((predicted - CONFIDENCE_BAND) * 10) / 10),
        confidenceHigh: Math.min(100, Math.round((predicted + CONFIDENCE_BAND) * 10) / 10),
      });
    }

    const trend = trendSlope > 0.5 ? 'improving' : trendSlope < -0.5 ? 'degrading' : 'stable';
    log.info('Health forecast computed', { connectorId, daysAhead, trend, lastScore: lastSmoothed });

    return { connectorId, forecastDays: daysAhead, forecast, trend, modelType: 'exponential_smoothing' };
  }

  /**
   * Detect anomalies by comparing actual values against smoothed forecast.
   * Anomaly = deviation > 2σ from smoothed series.
   * @param metrics - Historical metrics
   * @returns AnomalyDetection result
   */
  detectAnomalies(metrics: HealthMetricPoint[]): AnomalyDetection {
    if (metrics.length < 3) {
      return { anomalies: [], hasAnomaly: false };
    }

    const scores = metrics.map((m) => m.healthScore);
    const smoothed = exponentialSmooth(scores);
    const residuals = scores.map((s, i) => s - smoothed[i]!);
    const sigma = stdDev(residuals);

    const anomalies = metrics
      .map((m, i) => ({ m, deviation: Math.abs(residuals[i]!) }))
      .filter(({ deviation }) => deviation > 2 * sigma)
      .map(({ m, deviation }) => ({
        date: m.date,
        actual: m.healthScore,
        expected: smoothed[metrics.indexOf(m)]!,
        deviationSigma: sigma > 0 ? Math.round((deviation / sigma) * 10) / 10 : 0,
      }));

    return { anomalies, hasAnomaly: anomalies.length > 0 };
  }

  /**
   * Generate proactive alerts based on health forecast.
   * @param connectorId - Connector to alert on
   * @param forecast - Forecast result from forecastHealth()
   * @returns Array of ForecastAlert
   */
  generateAlerts(connectorId: string, forecast: ForecastResult): ForecastAlert[] {
    const alerts: ForecastAlert[] = [];

    for (const point of forecast.forecast) {
      if (point.predictedScore < CRITICAL_THRESHOLD) {
        const daysUntil = Math.round((point.date.getTime() - Date.now()) / 86_400_000);
        const existing = alerts.find((a) => a.alertSeverity === 'critical');
        if (!existing) {
          alerts.push({
            connectorId,
            alertSeverity: 'critical',
            predictedIssue: 'health_decline',
            daysUntilThreshold: daysUntil,
            currentScore: forecast.forecast[0]?.predictedScore ?? 0,
            predictedScore: point.predictedScore,
            recommendedAction: `Investigate connector immediately — health predicted to drop below ${CRITICAL_THRESHOLD} in ${daysUntil} day(s)`,
            createdAt: new Date(),
          });
        }
      } else if (point.predictedScore < WARNING_THRESHOLD) {
        const daysUntil = Math.round((point.date.getTime() - Date.now()) / 86_400_000);
        const existing = alerts.find((a) => a.alertSeverity === 'warning');
        if (!existing) {
          alerts.push({
            connectorId,
            alertSeverity: 'warning',
            predictedIssue: 'health_decline',
            daysUntilThreshold: daysUntil,
            currentScore: forecast.forecast[0]?.predictedScore ?? 0,
            predictedScore: point.predictedScore,
            recommendedAction: `Review connector health — score predicted to drop below ${WARNING_THRESHOLD} in ${daysUntil} day(s)`,
            createdAt: new Date(),
          });
        }
      }
    }

    log.info('Forecast alerts generated', { connectorId, alertCount: alerts.length });
    return alerts;
  }

  /**
   * Full pipeline: metrics → forecast → anomaly detection → alerts.
   * @param connectorId - Connector identifier
   * @param metrics - Historical health time series
   * @param daysAhead - Forecast horizon
   */
  analyzeConnector(connectorId: string, metrics: HealthMetricPoint[], daysAhead = 7): {
    forecast: ForecastResult;
    anomalies: AnomalyDetection;
    alerts: ForecastAlert[];
  } {
    const forecast = this.forecastHealth(connectorId, metrics, daysAhead);
    const anomalies = this.detectAnomalies(metrics);
    const alerts = this.generateAlerts(connectorId, forecast);
    return { forecast, anomalies, alerts };
  }
}
