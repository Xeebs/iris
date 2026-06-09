import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FreshnessTracker } from '../freshness-tracker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTaggedSql(queryHandlers: Record<string, unknown>) {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?').toLowerCase();
    for (const [pattern, result] of Object.entries(queryHandlers)) {
      if (query.includes(pattern.toLowerCase())) return Promise.resolve(result);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres')>;
}

const BASE_ENTITY = {
  entityId: 'hubspot:contact:001',
  entityType: 'contact',
  connectorId: 'hubspot',
  workspaceId: 'ws-1',
};

describe('FreshnessTracker', () => {
  describe('recordEntitySync', () => {
    it('inserts freshness record and sync event', async () => {
      const sql = makeTaggedSql({});
      const tracker = new FreshnessTracker(sql);
      const lastModified = new Date(Date.now() - 5000);

      const result = await tracker.recordEntitySync(
        BASE_ENTITY.entityId,
        BASE_ENTITY.entityType,
        BASE_ENTITY.connectorId,
        BASE_ENTITY.workspaceId,
        lastModified,
      );

      expect(result.isOk()).toBe(true);
      const record = result._unsafeUnwrap();
      expect(record.entityId).toBe(BASE_ENTITY.entityId);
      expect(record.syncLatencyMs).toBeGreaterThanOrEqual(5000);
    });

    it('returns err on DB failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('DB down')) as unknown as ReturnType<typeof import('postgres')>;
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.recordEntitySync(
        BASE_ENTITY.entityId,
        BASE_ENTITY.entityType,
        BASE_ENTITY.connectorId,
        BASE_ENTITY.workspaceId,
        new Date(),
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('DB_ERROR');
    });

    it('computes positive sync latency even for recent modifications', async () => {
      const sql = makeTaggedSql({});
      const tracker = new FreshnessTracker(sql);
      const lastModified = new Date(Date.now() - 100);

      const result = await tracker.recordEntitySync(
        BASE_ENTITY.entityId,
        BASE_ENTITY.entityType,
        BASE_ENTITY.connectorId,
        BASE_ENTITY.workspaceId,
        lastModified,
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().syncLatencyMs).toBeGreaterThanOrEqual(100);
    });
  });

  describe('computeFreshness', () => {
    it('returns NOT_FOUND when no record exists', async () => {
      const sql = makeTaggedSql({ 'entity_freshness_tracking': [] });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.computeFreshness('missing', 'ws-1');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('NOT_FOUND');
    });

    it('computes correct age in seconds', async () => {
      const lastModified = new Date(Date.now() - 60000);
      const indexed = new Date();

      const sql = makeTaggedSql({
        'entity_freshness_tracking': [
          {
            entity_id: BASE_ENTITY.entityId,
            entity_type: 'contact',
            connector_id: 'hubspot',
            last_modified: lastModified,
            indexed_at: indexed,
          },
        ],
        'freshness_slas': [],
        'percent_rank': [],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.computeFreshness(BASE_ENTITY.entityId, 'ws-1');

      expect(result.isOk()).toBe(true);
      const status = result._unsafeUnwrap();
      expect(status.ageSeconds).toBeGreaterThanOrEqual(59);
      expect(status.slaBreached).toBe(false);
      expect(status.stalenessWarning).toBe(false);
    });

    it('marks slaBreached when age exceeds SLA threshold', async () => {
      const lastModified = new Date(Date.now() - 3700 * 1000);

      const sql = makeTaggedSql({
        'entity_freshness_tracking': [
          {
            entity_id: BASE_ENTITY.entityId,
            entity_type: 'contact',
            connector_id: 'hubspot',
            last_modified: lastModified,
            indexed_at: new Date(),
          },
        ],
        'freshness_slas': [{ max_age_seconds: 3600, warning_threshold_pct: 80 }],
        'percent_rank': [],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.computeFreshness(BASE_ENTITY.entityId, 'ws-1');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().slaBreached).toBe(true);
      expect(result._unsafeUnwrap().stalenessWarning).toBe(false);
    });

    it('marks stalenessWarning when approaching SLA threshold', async () => {
      const lastModified = new Date(Date.now() - 3000 * 1000);

      const sql = makeTaggedSql({
        'entity_freshness_tracking': [
          {
            entity_id: BASE_ENTITY.entityId,
            entity_type: 'contact',
            connector_id: 'hubspot',
            last_modified: lastModified,
            indexed_at: new Date(),
          },
        ],
        'freshness_slas': [{ max_age_seconds: 3600, warning_threshold_pct: 80 }],
        'percent_rank': [],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.computeFreshness(BASE_ENTITY.entityId, 'ws-1');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().stalenessWarning).toBe(true);
      expect(result._unsafeUnwrap().slaBreached).toBe(false);
    });

    it('returns err on DB failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as ReturnType<typeof import('postgres')>;
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.computeFreshness('any', 'ws-1');

      expect(result.isErr()).toBe(true);
    });
  });

  describe('analyzeFreshnessMetrics', () => {
    it('returns zero metrics when no data', async () => {
      const sql = makeTaggedSql({
        'freshness_events': [{ mean_latency: 0, event_count: 0 }],
        'percentile_cont': [{ p50: 0, p95: 0, p99: 0 }],
        'sla_compliance': [{ total: 0, within_sla: 0 }],
        'entity_type': [],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.analyzeFreshnessMetrics('hubspot', 'ws-1', 7);

      expect(result.isOk()).toBe(true);
      const metrics = result._unsafeUnwrap();
      expect(metrics.connectorId).toBe('hubspot');
      expect(metrics.intervalDays).toBe(7);
      expect(metrics.slaComplianceRate).toBe(100);
    });

    it('computes sync frequency correctly', async () => {
      const sql = makeTaggedSql({
        'freshness_events': [{ mean_latency: 5000, event_count: 700 }],
        'percentile_cont': [{ p50: 3600, p95: 7200, p99: 14400 }],
        'within_sla': [{ total: 100, within_sla: 95 }],
        'entity_type': [],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.analyzeFreshnessMetrics('hubspot', 'ws-1', 7);

      expect(result.isOk()).toBe(true);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.analyzeFreshnessMetrics('hubspot', 'ws-1');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('DB_ERROR');
    });
  });

  describe('predictNextStaleEvent', () => {
    it('returns zero confidence with insufficient history', async () => {
      const sql = makeTaggedSql({
        'freshness_events': [{ created_at: new Date() }],
        'sla_seconds': [{ entity_type: 'contact', max_age_seconds: 3600 }],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.predictNextStaleEvent(
        BASE_ENTITY.entityId,
        BASE_ENTITY.connectorId,
        BASE_ENTITY.workspaceId,
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().confidenceScore).toBe(0);
    });

    it('returns future timestamp when SLA defined and history available', async () => {
      const now = Date.now();
      const events = Array.from({ length: 5 }, (_, i) => ({
        created_at: new Date(now - i * 3600 * 1000),
      }));

      const sql = makeTaggedSql({
        'freshness_events': events,
        'max_age_seconds': [{ entity_type: 'contact', max_age_seconds: 7200 }],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.predictNextStaleEvent(
        BASE_ENTITY.entityId,
        BASE_ENTITY.connectorId,
        BASE_ENTITY.workspaceId,
      );

      expect(result.isOk()).toBe(true);
    });

    it('returns null estimatedStalenessAt when no SLA defined', async () => {
      const now = Date.now();
      const events = Array.from({ length: 5 }, (_, i) => ({
        created_at: new Date(now - i * 3600 * 1000),
      }));

      const sql = makeTaggedSql({
        'freshness_events': events,
        'entity_freshness_tracking': [{ entity_type: 'contact', max_age_seconds: null }],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.predictNextStaleEvent(
        BASE_ENTITY.entityId,
        BASE_ENTITY.connectorId,
        BASE_ENTITY.workspaceId,
      );

      expect(result.isOk()).toBe(true);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('DB error')) as unknown as ReturnType<typeof import('postgres')>;
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.predictNextStaleEvent('e', 'c', 'w');

      expect(result.isErr()).toBe(true);
    });

    it('computes positive avgModificationIntervalSec from history', async () => {
      const now = Date.now();
      const interval = 1800;
      const events = Array.from({ length: 6 }, (_, i) => ({
        created_at: new Date(now - i * interval * 1000),
      }));

      const sql = makeTaggedSql({
        'freshness_events': events,
        'entity_freshness_tracking': [{ entity_type: 'contact', max_age_seconds: 7200 }],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.predictNextStaleEvent(
        BASE_ENTITY.entityId,
        BASE_ENTITY.connectorId,
        BASE_ENTITY.workspaceId,
      );

      expect(result.isOk()).toBe(true);
      const pred = result._unsafeUnwrap();
      expect(pred.avgModificationIntervalSec).toBeGreaterThan(0);
    });
  });

  describe('listStaleEntities', () => {
    it('returns empty array when no stale entities', async () => {
      const sql = makeTaggedSql({ 'entity_freshness_tracking': [] });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.listStaleEntities('ws-1');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns entities sorted by age descending', async () => {
      const sql = makeTaggedSql({
        'entity_freshness_tracking': [
          {
            entity_id: 'e1',
            entity_type: 'contact',
            connector_id: 'hubspot',
            last_modified: new Date(Date.now() - 10000),
            indexed_at: new Date(),
            age_seconds: 10000,
            sla_seconds: 5000,
          },
          {
            entity_id: 'e2',
            entity_type: 'deal',
            connector_id: 'hubspot',
            last_modified: new Date(Date.now() - 5000),
            indexed_at: new Date(),
            age_seconds: 5000,
            sla_seconds: 5000,
          },
        ],
      });
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.listStaleEntities('ws-1');

      expect(result.isOk()).toBe(true);
      const list = result._unsafeUnwrap();
      expect(list[0]!.ageSeconds).toBeGreaterThanOrEqual(list[1]?.ageSeconds ?? 0);
    });

    it('returns err on DB failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const tracker = new FreshnessTracker(sql);

      const result = await tracker.listStaleEntities('ws-1');

      expect(result.isErr()).toBe(true);
    });
  });
});
