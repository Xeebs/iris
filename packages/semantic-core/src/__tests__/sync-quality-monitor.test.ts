import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SyncQualityMonitor,
  computeCompleteness,
  computeUniqueValueRatio,
  computeSchemaStability,
  detectNewAttributes,
  computeZScore,
} from '../sync-quality-monitor.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import type postgres from 'postgres';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

type SqlClient = ReturnType<typeof postgres>;

function makeSql(rows: unknown[] = []): SqlClient {
  const tagged = vi.fn().mockResolvedValue(rows);
  // Support .unsafe() chaining used by the monitor for INTERVAL interpolation
  (tagged as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
  return tagged as unknown as SqlClient;
}

function makeEntity(attrs: Record<string, unknown> = {}): SemanticEntity {
  return {
    id: 'test:contact:1',
    type: 'contact',
    label: 'Test Entity',
    attributes: attrs as SemanticEntity['attributes'],
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: 'test:contact:1',
  };
}

// ─── Pure function tests ──────────────────────────────────────────────────────

describe('computeCompleteness', () => {
  it('returns 100 for empty entity list', () => {
    expect(computeCompleteness([])).toBe(100);
  });

  it('returns 100 when all attributes are non-null', () => {
    const entities = [makeEntity({ name: 'Alice', email: 'alice@test.com' })];
    expect(computeCompleteness(entities)).toBe(100);
  });

  it('returns 50 when half attributes are null', () => {
    const entities = [makeEntity({ name: 'Alice', email: null })];
    expect(computeCompleteness(entities)).toBe(50);
  });

  it('aggregates completeness across multiple entities', () => {
    const entities = [
      makeEntity({ name: 'Alice', email: 'alice@test.com' }),
      makeEntity({ name: 'Bob', email: null }),
    ];
    expect(computeCompleteness(entities)).toBe(75);
  });

  it('treats empty string as null (incomplete)', () => {
    const entities = [makeEntity({ name: '', email: 'a@b.com' })];
    expect(computeCompleteness(entities)).toBe(50);
  });

  it('returns 100 for entity with no attributes', () => {
    const entities = [makeEntity({})];
    expect(computeCompleteness(entities)).toBe(100);
  });
});

describe('computeUniqueValueRatio', () => {
  it('returns 1 for empty entity list', () => {
    expect(computeUniqueValueRatio([])).toBe(1);
  });

  it('returns 1 when all values are unique', () => {
    const entities = [
      makeEntity({ stage: 'open' }),
      makeEntity({ stage: 'closed' }),
    ];
    expect(computeUniqueValueRatio(entities)).toBe(1);
  });

  it('returns low ratio when all values are the same', () => {
    const entities = [
      makeEntity({ stage: 'open' }),
      makeEntity({ stage: 'open' }),
      makeEntity({ stage: 'open' }),
    ];
    expect(computeUniqueValueRatio(entities)).toBeLessThan(0.5);
  });
});

describe('computeSchemaStability', () => {
  it('returns 100 when known names is empty (first sync)', () => {
    expect(computeSchemaStability(['name', 'email'], [])).toBe(100);
  });

  it('returns 100 when current names exactly match known names', () => {
    expect(computeSchemaStability(['name', 'email'], ['name', 'email'])).toBe(100);
  });

  it('returns 50 when half attributes are new', () => {
    expect(computeSchemaStability(['name', 'newField'], ['name', 'email'])).toBe(50);
  });

  it('returns 0 when all attributes are new', () => {
    expect(computeSchemaStability(['newA', 'newB'], ['oldA', 'oldB'])).toBe(0);
  });

  it('returns 0 when current names is empty', () => {
    expect(computeSchemaStability([], ['name', 'email'])).toBe(0);
  });
});

describe('detectNewAttributes', () => {
  it('returns empty array when no new attributes', () => {
    expect(detectNewAttributes(['name', 'email'], ['name', 'email'])).toEqual([]);
  });

  it('returns new attributes not in known set', () => {
    expect(detectNewAttributes(['name', 'email', 'phone'], ['name', 'email'])).toEqual(['phone']);
  });

  it('returns empty array when knownNames is empty (first sync)', () => {
    expect(detectNewAttributes(['name', 'email'], [])).toEqual([]);
  });
});

describe('computeZScore', () => {
  it('returns 0 when stdDev is 0', () => {
    expect(computeZScore(100, 100, 0)).toBe(0);
  });

  it('returns positive z-score for above-mean values', () => {
    const z = computeZScore(130, 100, 10);
    expect(z).toBe(3);
  });

  it('returns negative z-score for below-mean values', () => {
    const z = computeZScore(70, 100, 10);
    expect(z).toBe(-3);
  });

  it('returns 0 for value equal to mean', () => {
    expect(computeZScore(100, 100, 10)).toBe(0);
  });
});

// ─── SyncQualityMonitor service tests ────────────────────────────────────────

describe('SyncQualityMonitor', () => {
  let sql: SqlClient;
  let monitor: SyncQualityMonitor;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSql([{ id: 'record-uuid-1' }]);
    monitor = new SyncQualityMonitor(sql);
  });

  describe('recordSyncMetrics()', () => {
    it('inserts a record and returns ok with the ID', async () => {
      const result = await monitor.recordSyncMetrics('sync-1', 'conn-1', 'ws-1', {
        entityCount: 100,
        completenessePct: 95,
        uniqueValueRatio: 0.8,
        schemaStabilityPct: 100,
        attributeNames: ['name', 'email'],
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('record-uuid-1');
      expect(sql).toHaveBeenCalledOnce();
    });

    it('auto-computes completeness when entities provided', async () => {
      const entities = [makeEntity({ name: 'Alice', email: null })];
      const result = await monitor.recordSyncMetrics('sync-2', 'conn-1', 'ws-1', {
        entityCount: 1,
        entities,
      });
      expect(result.isOk()).toBe(true);
    });

    it('returns err when DB throws', async () => {
      vi.mocked(sql).mockRejectedValue(new Error('db connection failed'));
      const result = await monitor.recordSyncMetrics('sync-1', 'conn-1', 'ws-1', {
        entityCount: 50,
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/db connection failed/);
    });
  });

  describe('detectAnomalies()', () => {
    it('returns empty anomalies when no records exist', async () => {
      // First call = thresholds (empty) → use defaults; second call = metrics (empty)
      sql = makeSql([]);
      (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
      monitor = new SyncQualityMonitor(sql);

      const result = await monitor.detectAnomalies('conn-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().anomalies).toHaveLength(0);
    });

    it('returns empty anomalies when fewer than 4 records (insufficient baseline)', async () => {
      const makeRow = (entityCount: number) => ({
        id: 'r1',
        sync_id: 's1',
        connector_id: 'conn-1',
        workspace_id: 'ws-1',
        entity_count: entityCount,
        completeness_pct: '90',
        unique_value_ratio: '0.7',
        schema_stability_pct: '100',
        anomaly_flags: [],
        attribute_names: ['name', 'email'],
        recorded_at: new Date(),
      });

      // thresholds: empty → defaults; metrics: 2 rows (1 latest + 1 historical = not enough for z-score)
      sql = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeRow(100), makeRow(98)]) as unknown as SqlClient;
      (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
      monitor = new SyncQualityMonitor(sql);

      const result = await monitor.detectAnomalies('conn-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().anomalies).toHaveLength(0);
    });

    it('returns err when DB throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('query failed')) as unknown as SqlClient;
      (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
      monitor = new SyncQualityMonitor(sql);

      const result = await monitor.detectAnomalies('conn-1', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('trackDataQualityTrend()', () => {
    it('returns empty dataPoints when no records exist', async () => {
      sql = makeSql([]);
      (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
      monitor = new SyncQualityMonitor(sql);

      const result = await monitor.trackDataQualityTrend('conn-1', 'ws-1', 30);
      expect(result.isOk()).toBe(true);
      const trend = result._unsafeUnwrap();
      expect(trend.dataPoints).toHaveLength(0);
      expect(trend.summary.entityCountTrend).toBe('stable');
    });

    it('maps DB rows to TrendPoints correctly', async () => {
      const row = {
        sync_id: 'sync-abc',
        entity_count: 150,
        completeness_pct: '92.5',
        schema_stability_pct: '98.0',
        anomaly_flags: ['entity_count_deviation'],
        recorded_at: new Date('2026-06-01T10:00:00Z'),
      };
      sql = makeSql([row]);
      (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
      monitor = new SyncQualityMonitor(sql);

      const result = await monitor.trackDataQualityTrend('conn-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      const [point] = result._unsafeUnwrap().dataPoints;
      expect(point?.syncId).toBe('sync-abc');
      expect(point?.entityCount).toBe(150);
      expect(point?.completenessePct).toBe(92.5);
      expect(point?.anomalyFlags).toEqual(['entity_count_deviation']);
    });

    it('returns err when DB throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as SqlClient;
      (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
      monitor = new SyncQualityMonitor(sql);

      const result = await monitor.trackDataQualityTrend('conn-1', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('configureThresholds()', () => {
    it('upserts thresholds and returns ok', async () => {
      const result = await monitor.configureThresholds('conn-1', 'ws-1', {
        entityCountZscoreThreshold: 2.5,
        completenessDropThreshold: 0.15,
      });
      expect(result.isOk()).toBe(true);
    });

    it('returns err when DB throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('upsert failed')) as unknown as SqlClient;
      (sql as unknown as Record<string, unknown>).unsafe = vi.fn().mockReturnValue('30');
      monitor = new SyncQualityMonitor(sql);

      const result = await monitor.configureThresholds('conn-1', 'ws-1', {});
      expect(result.isErr()).toBe(true);
    });
  });
});
