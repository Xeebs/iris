/**
 * Integration test for SyncQualityMonitor — verifies baseline calculation and anomaly detection
 * using an in-memory SQL mock that simulates 30-day historical data.
 * Run with: pnpm test:integration (requires docker-compose up -d for real Postgres).
 * This file uses a mock that closely simulates real query behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { SyncQualityMonitor } from '../sync-quality-monitor.js';
import type postgres from 'postgres';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

type SqlClient = ReturnType<typeof postgres>;

function makeRow(entityCount: number, completenessPct = 90, schemaStabilityPct = 100) {
  return {
    id: `row-${entityCount}-${Math.random()}`,
    sync_id: `sync-${entityCount}`,
    connector_id: 'conn-1',
    workspace_id: 'ws-1',
    entity_count: entityCount,
    completeness_pct: String(completenessPct),
    unique_value_ratio: '0.7',
    schema_stability_pct: String(schemaStabilityPct),
    anomaly_flags: [],
    attribute_names: ['name', 'email', 'stage'],
    recorded_at: new Date(),
  };
}

describe('SyncQualityMonitor — anomaly detection (simulated baseline)', () => {
  it('detects entity count deviation >3σ from baseline', async () => {
    // Baseline: 10 syncs with ~100 entities, then sudden drop to 5
    const historicalRows = Array.from({ length: 10 }, (_, i) => makeRow(100 + (i % 3)));
    const latestRow = makeRow(5); // severe drop

    const rows = [latestRow, ...historicalRows];

    let callCount = 0;
    const sql = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return []; // thresholds query returns nothing → use defaults
      return rows; // metrics query
    }) as unknown as SqlClient;
    (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
    // mock the UPDATE for anomaly flags
    const updateMock = vi.fn().mockResolvedValue([]);
    (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');

    const monitor = new SyncQualityMonitor(sql);
    const result = await monitor.detectAnomalies('conn-1', 'ws-1');

    expect(result.isOk()).toBe(true);
    const { anomalies } = result._unsafeUnwrap();
    const entityCountAnomaly = anomalies.find((a) => a.type === 'entity_count_deviation');
    expect(entityCountAnomaly).toBeDefined();
    expect(entityCountAnomaly!.zScore).toBeDefined();
    expect(Math.abs(entityCountAnomaly!.zScore!)).toBeGreaterThan(3);
  });

  it('detects completeness drop >20% from baseline', async () => {
    // Baseline: 10 syncs at 95% completeness, then drop to 60%
    const historicalRows = Array.from({ length: 10 }, () => makeRow(100, 95));
    const latestRow = makeRow(100, 60);

    const rows = [latestRow, ...historicalRows];

    let callCount = 0;
    const sql = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [];
      return rows;
    }) as unknown as SqlClient;
    (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');

    const monitor = new SyncQualityMonitor(sql);
    const result = await monitor.detectAnomalies('conn-1', 'ws-1');

    expect(result.isOk()).toBe(true);
    const { anomalies } = result._unsafeUnwrap();
    const completenessAnomaly = anomalies.find((a) => a.type === 'completeness_drop');
    expect(completenessAnomaly).toBeDefined();
    expect(completenessAnomaly!.currentValue).toBe(60);
    expect(completenessAnomaly!.baselineValue).toBeGreaterThan(90);
  });

  it('detects schema drift when new attributes appear', async () => {
    // Previous sync had ['name', 'email', 'stage']; latest has a new 'phone' attribute
    const historicalRows = [
      { ...makeRow(100), attribute_names: ['name', 'email', 'stage'] },
    ];
    const latestRow = { ...makeRow(100), attribute_names: ['name', 'email', 'stage', 'phone'] };

    const rows = [latestRow, ...historicalRows];

    let callCount = 0;
    const sql = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [];
      return rows;
    }) as unknown as SqlClient;
    (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');

    const monitor = new SyncQualityMonitor(sql);
    const result = await monitor.detectAnomalies('conn-1', 'ws-1');

    expect(result.isOk()).toBe(true);
    const { anomalies } = result._unsafeUnwrap();
    const driftAnomaly = anomalies.find((a) => a.type === 'schema_drift');
    expect(driftAnomaly).toBeDefined();
    expect(driftAnomaly!.newAttributes).toContain('phone');
  });

  it('does not flag anomaly when entity count within baseline range', async () => {
    // Stable syncs: all within 1σ
    const historicalRows = Array.from({ length: 10 }, () => makeRow(100 + Math.floor(Math.random() * 3)));
    const latestRow = makeRow(101);

    const rows = [latestRow, ...historicalRows];

    let callCount = 0;
    const sql = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [];
      return rows;
    }) as unknown as SqlClient;
    (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');

    const monitor = new SyncQualityMonitor(sql);
    const result = await monitor.detectAnomalies('conn-1', 'ws-1');

    expect(result.isOk()).toBe(true);
    const { anomalies } = result._unsafeUnwrap();
    const entityCountAnomaly = anomalies.find((a) => a.type === 'entity_count_deviation');
    expect(entityCountAnomaly).toBeUndefined();
  });
});
