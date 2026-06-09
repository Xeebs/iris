import { describe, it, expect } from 'vitest';
import { ConnectorHealthForecaster } from '../health-forecaster.js';
import type { HealthMetricPoint } from '../health-forecaster.js';

function makeMetrics(scores: number[], startDate = new Date('2026-01-01')): HealthMetricPoint[] {
  return scores.map((healthScore, i) => ({
    date: new Date(startDate.getTime() + i * 86_400_000),
    healthScore,
  }));
}

// ─── forecastHealth ───────────────────────────────────────────────────────────

describe('ConnectorHealthForecaster.forecastHealth', () => {
  const forecaster = new ConnectorHealthForecaster();

  it('produces N forecast points matching daysAhead', () => {
    const metrics = makeMetrics([80, 82, 81, 83, 85]);
    const result = forecaster.forecastHealth('c-1', metrics, 7);
    expect(result.forecast).toHaveLength(7);
    expect(result.connectorId).toBe('c-1');
  });

  it('detects degrading trend', () => {
    const metrics = makeMetrics([90, 85, 78, 72, 65, 60, 55]);
    const result = forecaster.forecastHealth('c-2', metrics, 5);
    expect(result.trend).toBe('degrading');
  });

  it('detects improving trend', () => {
    const metrics = makeMetrics([50, 55, 62, 70, 78, 85, 90]);
    const result = forecaster.forecastHealth('c-3', metrics, 5);
    expect(result.trend).toBe('improving');
  });

  it('detects stable trend', () => {
    const metrics = makeMetrics([80, 81, 80, 79, 81, 80, 80]);
    const result = forecaster.forecastHealth('c-4', metrics, 5);
    expect(result.trend).toBe('stable');
  });

  it('keeps predicted scores within 0-100', () => {
    const metrics = makeMetrics([99, 100, 98, 100, 100]);
    const result = forecaster.forecastHealth('c-5', metrics, 7);
    for (const point of result.forecast) {
      expect(point.predictedScore).toBeLessThanOrEqual(100);
      expect(point.predictedScore).toBeGreaterThanOrEqual(0);
    }
  });

  it('confidence interval straddles predicted score', () => {
    const metrics = makeMetrics([75, 76, 74, 75, 77]);
    const result = forecaster.forecastHealth('c-6', metrics, 3);
    for (const p of result.forecast) {
      expect(p.confidenceLow).toBeLessThanOrEqual(p.predictedScore);
      expect(p.confidenceHigh).toBeGreaterThanOrEqual(p.predictedScore);
    }
  });
});

// ─── detectAnomalies ──────────────────────────────────────────────────────────

describe('ConnectorHealthForecaster.detectAnomalies', () => {
  const forecaster = new ConnectorHealthForecaster();

  it('returns no anomalies for smooth data', () => {
    const metrics = makeMetrics([80, 81, 79, 80, 82, 80]);
    const result = forecaster.detectAnomalies(metrics);
    expect(result.hasAnomaly).toBe(false);
  });

  it('detects a sudden spike as anomaly', () => {
    const metrics = makeMetrics([80, 80, 80, 80, 10, 80, 80]);
    const result = forecaster.detectAnomalies(metrics);
    expect(result.hasAnomaly).toBe(true);
    expect(result.anomalies.length).toBeGreaterThan(0);
  });

  it('returns empty for fewer than 3 data points', () => {
    const result = forecaster.detectAnomalies(makeMetrics([80, 75]));
    expect(result.anomalies).toHaveLength(0);
  });

  it('anomaly includes actual, expected, and sigma values', () => {
    const metrics = makeMetrics([80, 80, 80, 80, 10, 80]);
    const result = forecaster.detectAnomalies(metrics);
    if (result.hasAnomaly) {
      const a = result.anomalies[0]!;
      expect(typeof a.actual).toBe('number');
      expect(typeof a.expected).toBe('number');
      expect(a.deviationSigma).toBeGreaterThan(0);
    }
  });
});

// ─── generateAlerts ───────────────────────────────────────────────────────────

describe('ConnectorHealthForecaster.generateAlerts', () => {
  const forecaster = new ConnectorHealthForecaster();

  it('generates no alerts for healthy forecast', () => {
    const metrics = makeMetrics([80, 82, 85, 83, 84]);
    const forecast = forecaster.forecastHealth('c-1', metrics, 7);
    const alerts = forecaster.generateAlerts('c-1', forecast);
    expect(alerts).toHaveLength(0);
  });

  it('generates critical alert when forecast drops below 50', () => {
    const metrics = makeMetrics([70, 60, 50, 40, 30, 20]);
    const forecast = forecaster.forecastHealth('c-bad', metrics, 7);
    const alerts = forecaster.generateAlerts('c-bad', forecast);
    const critical = alerts.filter((a) => a.alertSeverity === 'critical');
    expect(critical.length).toBeGreaterThan(0);
  });

  it('generates warning alert when forecast drops below 70', () => {
    const metrics = makeMetrics([80, 75, 72, 68, 65, 62]);
    const forecast = forecaster.forecastHealth('c-warn', metrics, 7);
    const alerts = forecaster.generateAlerts('c-warn', forecast);
    expect(alerts.some((a) => a.alertSeverity === 'warning')).toBe(true);
  });

  it('alert includes recommendedAction', () => {
    const metrics = makeMetrics([60, 55, 50, 45, 40, 35]);
    const forecast = forecaster.forecastHealth('c-decline', metrics, 7);
    const alerts = forecaster.generateAlerts('c-decline', forecast);
    if (alerts.length > 0) {
      expect(alerts[0]!.recommendedAction.length).toBeGreaterThan(10);
    }
  });
});

// ─── analyzeConnector ─────────────────────────────────────────────────────────

describe('ConnectorHealthForecaster.analyzeConnector', () => {
  const forecaster = new ConnectorHealthForecaster();

  it('returns forecast, anomalies, and alerts together', () => {
    const metrics = makeMetrics([80, 80, 80, 80, 10, 80, 75]);
    const result = forecaster.analyzeConnector('c-full', metrics, 5);
    expect(result.forecast.forecast).toHaveLength(5);
    expect(typeof result.anomalies.hasAnomaly).toBe('boolean');
    expect(Array.isArray(result.alerts)).toBe(true);
  });
});
