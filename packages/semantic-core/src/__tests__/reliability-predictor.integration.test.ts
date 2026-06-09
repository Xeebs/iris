import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { ReliabilityPredictor } from '../reliability-predictor';

/**
 * Integration tests for ReliabilityPredictor — require Postgres with migration 149 applied.
 * Run with: pnpm test:integration --filter=semantic-core
 */

let sql: ReturnType<typeof postgres>;
let predictor: ReliabilityPredictor;

const WS = 'test-workspace-reliability';
const CONNECTOR = 'salesforce-test';

async function seedOutcomes(count: number, errorFraction = 0, latencyMs = 300) {
  const rows = Array.from({ length: count }, (_, i) => ({
    connector_id: CONNECTOR,
    workspace_id: WS,
    succeeded_at: new Date(Date.now() - i * 60_000),
    latency_ms: latencyMs,
    error_code: Math.random() < errorFraction ? 'TIMEOUT' : null,
  }));

  for (const row of rows) {
    await sql`
      INSERT INTO sync_outcomes (connector_id, workspace_id, succeeded_at, latency_ms, error_code)
      VALUES (${row.connector_id}, ${row.workspace_id}, ${row.succeeded_at}, ${row.latency_ms}, ${row.error_code})
    `;
  }
}

beforeAll(async () => {
  sql = postgres(process.env['DATABASE_URL'] ?? 'postgresql://iris:iris@localhost:5432/iris_test');
  predictor = new ReliabilityPredictor(sql);
});

afterAll(async () => {
  await sql`DELETE FROM sync_outcomes WHERE workspace_id = ${WS}`;
  await sql`DELETE FROM reliability_scores WHERE workspace_id = ${WS}`;
  await sql`DELETE FROM reliability_alerts WHERE workspace_id = ${WS}`;
  await sql`DELETE FROM alert_suppressions WHERE workspace_id = ${WS}`;
  await sql.end();
});

beforeEach(async () => {
  await sql`DELETE FROM sync_outcomes WHERE workspace_id = ${WS}`;
});

describe('ReliabilityPredictor (integration)', () => {
  describe('computeReliabilityScore', () => {
    it('persists score to reliability_scores table', async () => {
      await seedOutcomes(20, 0.1);
      await predictor.computeReliabilityScore(CONNECTOR, WS);

      const rows = await sql`
        SELECT score FROM reliability_scores
        WHERE connector_id = ${CONNECTOR} AND workspace_id = ${WS}
        ORDER BY computed_at DESC LIMIT 1
      `;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.score)).toBeLessThanOrEqual(100);
    });

    it('returns lower score for high error rate connectors', async () => {
      await seedOutcomes(20, 0.5);
      const result = await predictor.computeReliabilityScore(CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      const highErrorScore = result._unsafeUnwrap().score;

      await sql`DELETE FROM sync_outcomes WHERE workspace_id = ${WS}`;
      await seedOutcomes(20, 0);
      const resultClean = await predictor.computeReliabilityScore(CONNECTOR, WS);

      expect(resultClean.isOk()).toBe(true);
      const cleanScore = resultClean._unsafeUnwrap().score;
      expect(cleanScore).toBeGreaterThan(highErrorScore);
    });
  });

  describe('detectDegradationPattern', () => {
    it('detects anomaly in recent error spike', async () => {
      // Normal period
      await seedOutcomes(50, 0.02);
      // Recent spike
      for (let i = 0; i < 5; i++) {
        await sql`
          INSERT INTO sync_outcomes (connector_id, workspace_id, succeeded_at, latency_ms, error_code)
          VALUES (${CONNECTOR}, ${WS}, NOW(), 8000, 'TIMEOUT')
        `;
      }

      const result = await predictor.detectDegradationPattern(CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
    });
  });

  describe('forecastNextFailure', () => {
    it('returns increasing likelihood for connectors with error history', async () => {
      await seedOutcomes(100, 0.15);
      const result = await predictor.forecastNextFailure(CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      const f = result._unsafeUnwrap();
      expect(f.likelihood24h).toBeGreaterThanOrEqual(f.likelihood1h);
      expect(f.smoothedErrorRate).toBeGreaterThan(0);
    });
  });

  describe('emitProactiveAlert + listAlerts', () => {
    it('persists alert and retrieves it via listAlerts', async () => {
      await predictor.emitProactiveAlert(CONNECTOR, WS, 'critical', 'Test critical alert', 35);

      const result = await predictor.listAlerts(CONNECTOR, WS);
      expect(result.isOk()).toBe(true);
      const alerts = result._unsafeUnwrap();
      const match = alerts.find((a) => a.reason === 'Test critical alert');
      expect(match).toBeDefined();
      expect(match!.alertType).toBe('critical');
    });
  });

  describe('suppressAlert', () => {
    it('suppresses future alerts of same type', async () => {
      await predictor.suppressAlert(CONNECTOR, WS, 'warning', 'test-user', 3600000, 'test');

      // Emit a warning alert - it should be suppressed (no insert)
      const countBefore = await sql`
        SELECT COUNT(*)::INTEGER AS cnt FROM reliability_alerts
        WHERE connector_id = ${CONNECTOR} AND workspace_id = ${WS} AND alert_type = 'warning'
      `;
      await predictor.emitProactiveAlert(CONNECTOR, WS, 'warning', 'Should be suppressed', 65);
      const countAfter = await sql`
        SELECT COUNT(*)::INTEGER AS cnt FROM reliability_alerts
        WHERE connector_id = ${CONNECTOR} AND workspace_id = ${WS} AND alert_type = 'warning'
      `;

      expect(countAfter[0]!.cnt).toBe(countBefore[0]!.cnt);
    });
  });

  describe('runAssessmentCycle', () => {
    it('emits critical alert when reliability is low', async () => {
      await seedOutcomes(20, 0.9, 9000);
      const result = await predictor.runAssessmentCycle(CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      const alerts = result._unsafeUnwrap();
      const hasCritical = alerts.some((a) => a.alertType === 'critical');
      expect(hasCritical).toBe(true);
    });
  });
});
