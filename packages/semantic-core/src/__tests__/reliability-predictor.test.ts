import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReliabilityPredictor } from '../reliability-predictor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSql(overrides: Record<string, unknown> = {}) {
  return vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const q = strings.join('').toLowerCase();
    for (const [pattern, result] of Object.entries(overrides)) {
      if (q.includes(pattern.toLowerCase())) return Promise.resolve(result);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres')>;
}

const CONNECTOR = 'hubspot';
const WORKSPACE = 'ws-test';

describe('ReliabilityPredictor', () => {
  describe('computeReliabilityScore', () => {
    it('returns score 100 when no sync outcomes', async () => {
      const sql = makeSql({});
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.computeReliabilityScore(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().score).toBe(100);
    });

    it('computes lower score for high error rate', async () => {
      const outcomes = Array.from({ length: 20 }, (_, i) => ({
        succeededAt: new Date(),
        latencyMs: 500,
        errorCode: i < 10 ? 'TIMEOUT' : null,
      }));

      const sql = makeSql({ 'sync_outcomes': outcomes, 'schema_evolution': [] });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.computeReliabilityScore(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      const score = result._unsafeUnwrap().score;
      expect(score).toBeLessThan(70);
    });

    it('returns score between 0 and 100', async () => {
      const outcomes = [{ succeededAt: new Date(), latencyMs: 200, errorCode: null }];
      const sql = makeSql({ 'sync_outcomes': outcomes, 'schema_evolution': [] });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.computeReliabilityScore(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      const score = result._unsafeUnwrap().score;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('marks trend as degrading when recent errors spike', async () => {
      const outcomes = [
        ...Array.from({ length: 5 }, () => ({ succeededAt: new Date(), latencyMs: 500, errorCode: 'TIMEOUT' })),
        ...Array.from({ length: 5 }, () => ({ succeededAt: new Date(), latencyMs: 100, errorCode: null })),
      ];
      const sql = makeSql({ 'sync_outcomes': outcomes, 'schema_evolution': [] });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.computeReliabilityScore(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().trend).toBe('degrading');
    });

    it('marks trend as improving when recent errors fall', async () => {
      const outcomes = [
        ...Array.from({ length: 5 }, () => ({ succeededAt: new Date(), latencyMs: 100, errorCode: null })),
        ...Array.from({ length: 5 }, () => ({ succeededAt: new Date(), latencyMs: 500, errorCode: 'TIMEOUT' })),
      ];
      const sql = makeSql({ 'sync_outcomes': outcomes, 'schema_evolution': [] });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.computeReliabilityScore(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().trend).toBe('improving');
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('DB down')) as unknown as ReturnType<typeof import('postgres')>;
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.computeReliabilityScore(CONNECTOR, WORKSPACE);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('DB_ERROR');
    });
  });

  describe('detectDegradationPattern', () => {
    it('returns no anomaly with insufficient data', async () => {
      const sql = makeSql({ 'sync_outcomes': [{ bucket_hour: new Date(), error_count: 0, total_count: 10, avg_latency: 200, auth_failures: 0 }] });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.detectDegradationPattern(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().anomalyDetected).toBe(false);
    });

    it('detects auth failure anomaly', async () => {
      const hourly = Array.from({ length: 10 }, (_, i) => ({
        bucket_hour: new Date(),
        error_count: 0,
        total_count: 10,
        avg_latency: 200,
        auth_failures: i < 3 ? 3 : 0,
      }));
      const sql = makeSql({ 'sync_outcomes': hourly });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.detectDegradationPattern(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      const pattern = result._unsafeUnwrap();
      expect(pattern.anomalyDetected).toBe(true);
      expect(pattern.dominantSignal).toBe('auth_failures');
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.detectDegradationPattern(CONNECTOR, WORKSPACE);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('forecastNextFailure', () => {
    it('returns zero probabilities with no data', async () => {
      const sql = makeSql({});
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.forecastNextFailure(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      const forecast = result._unsafeUnwrap();
      expect(forecast.likelihood1h).toBe(0);
      expect(forecast.likelihood24h).toBe(0);
    });

    it('returns increasing probabilities with longer window', async () => {
      const hourly = Array.from({ length: 100 }, (_, i) => ({
        hour: new Date(Date.now() - i * 3600000),
        error_rate: 0.1,
      }));
      const sql = makeSql({ 'sync_outcomes': hourly });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.forecastNextFailure(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      const forecast = result._unsafeUnwrap();
      expect(forecast.likelihood24h).toBeGreaterThanOrEqual(forecast.likelihood1h);
      expect(forecast.likelihood7d).toBeGreaterThanOrEqual(forecast.likelihood24h);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.forecastNextFailure(CONNECTOR, WORKSPACE);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('emitProactiveAlert', () => {
    it('creates a warning alert when score below threshold', async () => {
      const sql = makeSql({});
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.emitProactiveAlert(
        CONNECTOR, WORKSPACE, 'warning', 'Score below 70', 65,
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().alertType).toBe('warning');
    });

    it('skips alert when suppressed', async () => {
      const sql = makeSql({ 'alert_suppressions': [{ count: 1 }] });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.emitProactiveAlert(
        CONNECTOR, WORKSPACE, 'warning', 'Suppressed', 65,
      );

      expect(result.isOk()).toBe(true);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.emitProactiveAlert(CONNECTOR, WORKSPACE, 'warning', 'test');

      expect(result.isErr()).toBe(true);
    });
  });

  describe('suggestMitigations', () => {
    it('returns at least one suggestion', async () => {
      const sql = makeSql({});
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.suggestMitigations(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().length).toBeGreaterThan(0);
    });

    it('prioritises auth failure mitigation when auth failures detected', async () => {
      const hourly = Array.from({ length: 10 }, (_, i) => ({
        bucket_hour: new Date(),
        error_count: 0,
        total_count: 10,
        avg_latency: 200,
        auth_failures: i < 3 ? 3 : 0,
      }));
      const sql = makeSql({ 'sync_outcomes': hourly, 'schema_evolution': [] });
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.suggestMitigations(CONNECTOR, WORKSPACE);

      expect(result.isOk()).toBe(true);
      const highPriority = result._unsafeUnwrap().filter((s) => s.priority === 'high');
      expect(highPriority.some((s) => s.action.toLowerCase().includes('auth') || s.action.toLowerCase().includes('credential'))).toBe(true);
    });
  });

  describe('suppressAlert', () => {
    it('inserts suppression record', async () => {
      const sql = makeSql({});
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.suppressAlert(
        CONNECTOR, WORKSPACE, 'warning', 'user-123', 3600000, 'false positive',
      );

      expect(result.isOk()).toBe(true);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const predictor = new ReliabilityPredictor(sql);

      const result = await predictor.suppressAlert(CONNECTOR, WORKSPACE, 'warning', 'user');

      expect(result.isErr()).toBe(true);
    });
  });
});
