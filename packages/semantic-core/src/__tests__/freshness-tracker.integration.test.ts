import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { FreshnessTracker } from '../freshness-tracker';

/**
 * Integration tests for FreshnessTracker — require Postgres with migration 148 applied.
 * Run with: pnpm test:integration --filter=semantic-core
 */

let sql: ReturnType<typeof postgres>;
let tracker: FreshnessTracker;

const WS = 'test-workspace-freshness';
const CONNECTOR = 'hubspot-test';

beforeAll(async () => {
  sql = postgres(process.env['DATABASE_URL'] ?? 'postgresql://iris:iris@localhost:5432/iris_test');
  tracker = new FreshnessTracker(sql);

  // Seed SLA config
  await sql`
    INSERT INTO freshness_slas (workspace_id, connector_id, entity_type, max_age_seconds, warning_threshold_pct)
    VALUES (${WS}, ${CONNECTOR}, 'contact', 3600, 80)
    ON CONFLICT (workspace_id, connector_id, entity_type) DO NOTHING
  `;
});

afterAll(async () => {
  await sql`DELETE FROM entity_freshness_tracking WHERE workspace_id = ${WS}`;
  await sql`DELETE FROM freshness_events WHERE workspace_id = ${WS}`;
  await sql`DELETE FROM freshness_slas WHERE workspace_id = ${WS}`;
  await sql.end();
});

describe('FreshnessTracker (integration)', () => {
  describe('recordEntitySync', () => {
    it('persists freshness record to Postgres', async () => {
      const entityId = `${CONNECTOR}:contact:int-001`;
      const lastModified = new Date(Date.now() - 30000);

      const result = await tracker.recordEntitySync(
        entityId,
        'contact',
        CONNECTOR,
        WS,
        lastModified,
      );

      expect(result.isOk()).toBe(true);

      const rows = await sql`
        SELECT entity_id, sync_latency_ms
        FROM entity_freshness_tracking
        WHERE entity_id = ${entityId} AND workspace_id = ${WS}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sync_latency_ms).toBeGreaterThanOrEqual(30000);
    });

    it('updates existing record on re-sync', async () => {
      const entityId = `${CONNECTOR}:contact:int-002`;
      const firstModified = new Date(Date.now() - 60000);
      await tracker.recordEntitySync(entityId, 'contact', CONNECTOR, WS, firstModified);

      const secondModified = new Date(Date.now() - 5000);
      await tracker.recordEntitySync(entityId, 'contact', CONNECTOR, WS, secondModified);

      const rows = await sql`
        SELECT last_modified FROM entity_freshness_tracking
        WHERE entity_id = ${entityId} AND workspace_id = ${WS}
      `;
      expect(rows).toHaveLength(1);
      const rowDate = new Date(rows[0]!.last_modified).getTime();
      const expectedDate = secondModified.getTime();
      expect(Math.abs(rowDate - expectedDate)).toBeLessThan(1000);
    });
  });

  describe('computeFreshness', () => {
    it('computes freshness with SLA compliance', async () => {
      const entityId = `${CONNECTOR}:contact:int-003`;
      const lastModified = new Date(Date.now() - 30000);
      await tracker.recordEntitySync(entityId, 'contact', CONNECTOR, WS, lastModified);

      const result = await tracker.computeFreshness(entityId, WS);

      expect(result.isOk()).toBe(true);
      const status = result._unsafeUnwrap();
      expect(status.ageSeconds).toBeGreaterThanOrEqual(29);
      expect(status.slaBreached).toBe(false);
      expect(status.slaSec).toBe(3600);
    });

    it('detects SLA breach for stale entity', async () => {
      const entityId = `${CONNECTOR}:contact:int-004`;
      const lastModified = new Date(Date.now() - 5000 * 1000);
      await tracker.recordEntitySync(entityId, 'contact', CONNECTOR, WS, lastModified);

      const result = await tracker.computeFreshness(entityId, WS);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().slaBreached).toBe(true);
    });

    it('records freshness events for SLA breaches', async () => {
      const entityId = `${CONNECTOR}:contact:int-005`;
      const lastModified = new Date(Date.now() - 5000 * 1000);
      await tracker.recordEntitySync(entityId, 'contact', CONNECTOR, WS, lastModified);
      await tracker.computeFreshness(entityId, WS);

      const events = await sql`
        SELECT event_type FROM freshness_events
        WHERE entity_id = ${entityId} AND workspace_id = ${WS} AND event_type = 'sla_breach'
      `;
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeFreshnessMetrics', () => {
    it('returns freshness percentiles from real data', async () => {
      for (let i = 0; i < 5; i++) {
        const entityId = `${CONNECTOR}:contact:int-metric-${i}`;
        const lastModified = new Date(Date.now() - (i + 1) * 600 * 1000);
        await tracker.recordEntitySync(entityId, 'contact', CONNECTOR, WS, lastModified);
      }

      const result = await tracker.analyzeFreshnessMetrics(CONNECTOR, WS, 7);

      expect(result.isOk()).toBe(true);
      const metrics = result._unsafeUnwrap();
      expect(metrics.freshnessP50).toBeGreaterThan(0);
      expect(metrics.freshnessP95).toBeGreaterThanOrEqual(metrics.freshnessP50);
    });

    it('computes entity type breakdown', async () => {
      const result = await tracker.analyzeFreshnessMetrics(CONNECTOR, WS, 7);

      expect(result.isOk()).toBe(true);
      const breakdown = result._unsafeUnwrap().entityTypeBreakdown;
      expect(breakdown.length).toBeGreaterThan(0);
      expect(breakdown[0]).toHaveProperty('entityType');
      expect(breakdown[0]).toHaveProperty('meanAgeSec');
    });
  });

  describe('predictNextStaleEvent', () => {
    it('returns prediction with confidence for repeated sync pattern', async () => {
      const entityId = `${CONNECTOR}:contact:int-predict`;
      for (let i = 0; i < 5; i++) {
        const lastModified = new Date(Date.now() - (i + 1) * 1800 * 1000);
        await tracker.recordEntitySync(entityId, 'contact', CONNECTOR, WS, lastModified);
      }

      const result = await tracker.predictNextStaleEvent(entityId, CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      const pred = result._unsafeUnwrap();
      expect(pred.avgModificationIntervalSec).toBeGreaterThan(0);
    });
  });

  describe('listStaleEntities', () => {
    it('returns entities breaching SLA threshold', async () => {
      const entityId = `${CONNECTOR}:contact:int-stale`;
      const lastModified = new Date(Date.now() - 5000 * 1000);
      await tracker.recordEntitySync(entityId, 'contact', CONNECTOR, WS, lastModified);

      const result = await tracker.listStaleEntities(WS, CONNECTOR);

      expect(result.isOk()).toBe(true);
      const stale = result._unsafeUnwrap();
      const match = stale.find((s) => s.entityId === entityId);
      expect(match).toBeDefined();
      expect(match!.slaBreached).toBe(true);
    });

    it('filters by connectorId when provided', async () => {
      const result = await tracker.listStaleEntities(WS, 'non-existent-connector');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });
});
