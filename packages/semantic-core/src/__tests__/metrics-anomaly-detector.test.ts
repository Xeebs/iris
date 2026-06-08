import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MetricsAnomalyDetector,
  computeStats,
  zScore,
  exponentialSmoothing,
  forecastValues,
} from '../metrics-anomaly-detector.js';

// ─── Pure function tests ───────────────────────────────────────────────────────

describe('computeStats', () => {
  it('returns zeros for empty array', () => {
    expect(computeStats([])).toEqual({ mean: 0, stdDev: 0 });
  });

  it('returns correct mean and stdDev for a simple dataset', () => {
    const { mean, stdDev } = computeStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean).toBeCloseTo(5, 5);
    expect(stdDev).toBeCloseTo(2, 1);
  });

  it('returns stdDev=0 for single element', () => {
    const { mean, stdDev } = computeStats([42]);
    expect(mean).toBe(42);
    expect(stdDev).toBe(0);
  });

  it('returns stdDev=0 for all identical values (zero variance)', () => {
    const { stdDev } = computeStats([5, 5, 5, 5]);
    expect(stdDev).toBe(0);
  });
});

describe('zScore', () => {
  it('returns 0 when stdDev is 0', () => {
    expect(zScore(10, 10, 0)).toBe(0);
  });

  it('returns correct z-score for known values', () => {
    expect(zScore(7, 5, 2)).toBeCloseTo(1.0);
    expect(zScore(9, 5, 2)).toBeCloseTo(2.0);
  });

  it('returns absolute value (always positive)', () => {
    expect(zScore(3, 5, 2)).toBeCloseTo(1.0);
  });
});

describe('exponentialSmoothing', () => {
  it('returns empty array for empty input', () => {
    expect(exponentialSmoothing([], 0.3)).toEqual([]);
  });

  it('first smoothed value equals first data point', () => {
    const smoothed = exponentialSmoothing([10, 20, 30], 0.3);
    expect(smoothed[0]).toBe(10);
  });

  it('higher alpha gives more weight to recent values', () => {
    const low = exponentialSmoothing([10, 100], 0.1);
    const high = exponentialSmoothing([10, 100], 0.9);
    expect(high[1]!).toBeGreaterThan(low[1]!);
  });

  it('produces stable output for constant input', () => {
    const smoothed = exponentialSmoothing([5, 5, 5, 5, 5], 0.3);
    expect(smoothed.every(v => v === 5)).toBe(true);
  });
});

describe('forecastValues', () => {
  it('returns zero array for empty input', () => {
    expect(forecastValues([], 3)).toEqual([0, 0, 0]);
  });

  it('returns correct number of forecast points', () => {
    const result = forecastValues([1, 2, 3, 4, 5], 7);
    expect(result).toHaveLength(7);
  });

  it('forecasts upward trend (later forecast values higher than earlier)', () => {
    const rising = [10, 20, 30, 40, 50];
    const forecast = forecastValues(rising, 3);
    // exponential smoothing lags behind raw values, but the trend should be captured
    expect(forecast[forecast.length - 1]!).toBeGreaterThan(forecast[0]!);
  });

  it('forecasts downward trend (later forecast values lower than earlier)', () => {
    const falling = [50, 40, 30, 20, 10];
    const forecast = forecastValues(falling, 3);
    expect(forecast[forecast.length - 1]!).toBeLessThan(forecast[0]!);
  });

  it('extrapolates flat series approximately flat', () => {
    const flat = [100, 100, 100, 100, 100];
    const forecast = forecastValues(flat, 3);
    expect(forecast.every(v => Math.abs(v - 100) < 0.01)).toBe(true);
  });
});

// ─── MetricsAnomalyDetector class tests ───────────────────────────────────────

function makeSql(result: unknown[] = []) {
  return vi.fn().mockResolvedValue(result) as unknown as ConstructorParameters<typeof MetricsAnomalyDetector>[0];
}

const METRIC_ID = 'metric:arr';

function makeValueRow(value: number, daysAgo = 1) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return { recorded_at: d.toISOString(), value };
}

describe('MetricsAnomalyDetector', () => {
  let detector: MetricsAnomalyDetector;
  let sql: ReturnType<typeof makeSql>;

  beforeEach(() => {
    sql = makeSql();
    detector = new MetricsAnomalyDetector(sql);
  });

  describe('detectAnomalies', () => {
    it('returns empty array when fewer than 3 data points', async () => {
      sql.mockResolvedValueOnce([makeValueRow(10), makeValueRow(20)]);
      const result = await detector.detectAnomalies(METRIC_ID);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('detects obvious outlier in a series', async () => {
      // Use 20 clean values to dilute mean/stdDev — prevents the outlier from masking itself
      const rows = [
        ...Array.from({ length: 20 }, (_, i) => makeValueRow(100 + (i % 3), 30 - i)),
        makeValueRow(500, 1), // clear outlier
      ];
      sql
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce([{ anomaly_id: 'a-1' }]);

      const result = await detector.detectAnomalies(METRIC_ID, 30, 'medium');
      expect(result.isOk()).toBe(true);
      const anomalies = result._unsafeUnwrap();
      expect(anomalies.length).toBeGreaterThanOrEqual(1);
      const outlier = anomalies.find(a => a.observedValue === 500);
      expect(outlier).toBeDefined();
      expect(outlier?.severity).toBe('high');
    });

    it('returns empty array when no anomalies found', async () => {
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeValueRow(100 + i * 0.5, 30 - i)
      );
      sql.mockResolvedValueOnce(rows);
      const result = await detector.detectAnomalies(METRIC_ID);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('uses low sensitivity threshold (fewer detections)', async () => {
      const rows = [
        ...Array.from({ length: 8 }, (_, i) => makeValueRow(100, i + 5)),
        makeValueRow(160, 2),
        makeValueRow(155, 1),
      ];
      sql.mockResolvedValueOnce(rows);
      const lowResult = await detector.detectAnomalies(METRIC_ID, 30, 'low');
      sql.mockResolvedValueOnce(rows)
        .mockResolvedValueOnce([{ anomaly_id: 'x' }])
        .mockResolvedValueOnce([{ anomaly_id: 'y' }]);
      const highResult = await detector.detectAnomalies(METRIC_ID, 30, 'high');
      expect(lowResult._unsafeUnwrap().length).toBeLessThanOrEqual(
        highResult._unsafeUnwrap().length
      );
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValueOnce(new Error('timeout'));
      const result = await detector.detectAnomalies(METRIC_ID);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('forecastMetricValue', () => {
    it('returns empty array when no historical data', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await detector.forecastMetricValue(METRIC_ID, 7);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('returns forecast with correct number of points', async () => {
      const rows = Array.from({ length: 14 }, (_, i) =>
        makeValueRow(100 + i * 5, 14 - i)
      );
      sql.mockResolvedValueOnce(rows);
      const result = await detector.forecastMetricValue(METRIC_ID, 5);
      expect(result._unsafeUnwrap().length).toBe(5);
    });

    it('each forecast point has a valid trend direction', async () => {
      const rows = Array.from({ length: 7 }, (_, i) => makeValueRow(100 + i, 7 - i));
      sql.mockResolvedValueOnce(rows);
      const result = await detector.forecastMetricValue(METRIC_ID, 3);
      const points = result._unsafeUnwrap();
      for (const p of points) {
        expect(['up', 'down', 'stable']).toContain(p.trend);
      }
    });
  });

  describe('anomalyContext', () => {
    it('returns context with nearby lineage events', async () => {
      sql.mockResolvedValueOnce([
        {
          entity_id: 'contact:1',
          event_type: 'update',
          occurred_at: new Date().toISOString(),
          description: 'ARR updated',
        },
      ]);
      const result = await detector.anomalyContext(METRIC_ID, new Date());
      const ctx = result._unsafeUnwrap();
      expect(ctx.metricId).toBe(METRIC_ID);
      expect(ctx.nearbyLineageEvents.length).toBe(1);
      expect(ctx.nearbyLineageEvents[0]?.description).toBe('ARR updated');
    });

    it('returns empty events when no lineage found', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await detector.anomalyContext(METRIC_ID, new Date());
      expect(result._unsafeUnwrap().nearbyLineageEvents).toEqual([]);
    });
  });

  describe('listAnomalies', () => {
    it('returns anomalies from DB', async () => {
      sql.mockResolvedValueOnce([
        {
          anomaly_id: 'a-1',
          metric_id: METRIC_ID,
          anomaly_date: new Date().toISOString(),
          observed_value: 500,
          expected_value: 100,
          z_score: 3.2,
          severity: 'high',
          detected_at: new Date().toISOString(),
          acknowledged_at: null,
          notes: null,
        },
      ]);
      const result = await detector.listAnomalies(METRIC_ID);
      const anomalies = result._unsafeUnwrap();
      expect(anomalies.length).toBe(1);
      expect(anomalies[0]?.severity).toBe('high');
    });
  });

  describe('acknowledgeAnomaly', () => {
    it('calls UPDATE correctly', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await detector.acknowledgeAnomaly('a-1', 'Investigated — expected spike');
      expect(result.isOk()).toBe(true);
    });
  });
});
