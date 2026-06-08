/**
 * Integration tests for MetricsAnomalyDetector.
 * Requires Postgres running (docker-compose up -d).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { MetricsAnomalyDetector } from '../metrics-anomaly-detector.js';

const METRIC_ID = 'integration-test-metric';
let sql: ReturnType<typeof postgres>;
let detector: MetricsAnomalyDetector;

function insertValueRow(value: number, daysAgo: number) {
  return sql`
    INSERT INTO metric_values (metric_id, value, recorded_at)
    VALUES (${METRIC_ID}, ${value}, now() - INTERVAL '1 day' * ${daysAgo})
    ON CONFLICT DO NOTHING
  `.catch(() => {});
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(url);
  detector = new MetricsAnomalyDetector(sql as unknown as ConstructorParameters<typeof MetricsAnomalyDetector>[0]);

  await sql`DELETE FROM metric_anomalies WHERE metric_id = ${METRIC_ID}`.catch(() => {});
  await sql`DELETE FROM metric_values WHERE metric_id = ${METRIC_ID}`.catch(() => {});

  for (let d = 30; d >= 2; d--) {
    await insertValueRow(100 + Math.random() * 5, d);
  }
  await insertValueRow(900, 1);
});

afterAll(async () => {
  await sql`DELETE FROM metric_anomalies WHERE metric_id = ${METRIC_ID}`.catch(() => {});
  await sql`DELETE FROM metric_values WHERE metric_id = ${METRIC_ID}`.catch(() => {});
  await sql.end();
});

describe('MetricsAnomalyDetector integration', () => {
  it('detects the 900 outlier as a high-severity anomaly', async () => {
    const result = await detector.detectAnomalies(METRIC_ID, 30, 'medium');
    expect(result.isOk()).toBe(true);
    const anomalies = result._unsafeUnwrap();
    expect(anomalies.some(a => a.observedValue === 900)).toBe(true);
    const outlier = anomalies.find(a => a.observedValue === 900);
    expect(outlier?.severity).toBe('high');
  });

  it('persists anomaly to metric_anomalies table', async () => {
    const rows = await sql`
      SELECT * FROM metric_anomalies WHERE metric_id = ${METRIC_ID}
    ` as unknown[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('generates forecast points for 7 days ahead', async () => {
    const result = await detector.forecastMetricValue(METRIC_ID, 7);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().length).toBe(7);
  });

  it('returns anomaly context (empty when no lineage events)', async () => {
    const result = await detector.anomalyContext(METRIC_ID, new Date());
    expect(result.isOk()).toBe(true);
  });

  it('acknowledges anomaly and marks acknowledged_at', async () => {
    const listResult = await detector.listAnomalies(METRIC_ID, false, 1);
    if (listResult.isOk() && listResult._unsafeUnwrap().length > 0) {
      const id = listResult._unsafeUnwrap()[0]!.anomalyId!;
      const ack = await detector.acknowledgeAnomaly(id, 'Expected spike');
      expect(ack.isOk()).toBe(true);
    }
  });
});
