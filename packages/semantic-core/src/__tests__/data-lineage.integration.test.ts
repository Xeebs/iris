import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { DataLineageService } from '../data-lineage.js';

/**
 * Integration tests for DataLineageService with a real Postgres instance.
 * Requires: docker-compose up -d (Postgres on 5432)
 * Run with: pnpm test:integration --filter @iris/semantic-core
 */
const DB_URL = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
const TEST_WS = 'test-lineage-ws-001';

describe.skipIf(!process.env['DATABASE_URL'])('DataLineageService (integration)', () => {
  let sql: ReturnType<typeof postgres>;
  let svc: DataLineageService;

  beforeAll(async () => {
    sql = postgres(DB_URL);
    svc = new DataLineageService(sql);

    // Ensure schema exists
    await sql`
      CREATE TABLE IF NOT EXISTS entity_lineage (
        id                    BIGSERIAL       PRIMARY KEY,
        entity_id             TEXT            NOT NULL,
        workspace_id          TEXT            NOT NULL,
        source_connector_id   TEXT            NOT NULL DEFAULT 'unknown',
        source_sync_job_id    TEXT,
        source_api_timestamp  TIMESTAMPTZ,
        lineage_json          JSONB           NOT NULL DEFAULT '{"transformations":[]}',
        last_modified_by      TEXT            NOT NULL DEFAULT 'system',
        last_modified_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
        UNIQUE (entity_id, workspace_id)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS entity_dependencies (
        id                    BIGSERIAL PRIMARY KEY,
        entity_id             TEXT NOT NULL,
        depends_on_entity_id  TEXT NOT NULL,
        workspace_id          TEXT NOT NULL,
        relationship_type     TEXT NOT NULL DEFAULT 'references'
          CHECK (relationship_type IN ('references', 'contains', 'derived_from', 'shares_owner')),
        confidence            NUMERIC(4,3) NOT NULL DEFAULT 1.0,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (entity_id, depends_on_entity_id, workspace_id)
      )
    `;
  });

  beforeEach(async () => {
    await sql`DELETE FROM entity_lineage WHERE workspace_id = ${TEST_WS}`;
    await sql`DELETE FROM entity_dependencies WHERE workspace_id = ${TEST_WS}`;
  });

  afterAll(async () => {
    await sql`DELETE FROM entity_lineage WHERE workspace_id = ${TEST_WS}`;
    await sql`DELETE FROM entity_dependencies WHERE workspace_id = ${TEST_WS}`;
    await sql.end();
  });

  // ---------------------------------------------------------------------------
  // recordOrigin
  // ---------------------------------------------------------------------------

  it('records entity origin and retrieves lineage record', async () => {
    await svc.recordOrigin('entity:001', TEST_WS, {
      connectorId: 'hubspot',
      syncJobId: 'job-abc',
      modifiedBy: 'sync-worker',
    });

    const record = await svc.getLineage('entity:001', TEST_WS);
    expect(record).not.toBeNull();
    expect(record!.entityId).toBe('entity:001');
    expect(record!.sourceConnectorId).toBe('hubspot');
    expect(record!.sourceSyncJobId).toBe('job-abc');
    expect(record!.lastModifiedBy).toBe('sync-worker');
    expect(record!.transformations).toHaveLength(0);
  });

  it('idempotently updates origin on repeated calls', async () => {
    await svc.recordOrigin('entity:001', TEST_WS, { connectorId: 'hubspot', syncJobId: 'job-1' });
    await svc.recordOrigin('entity:001', TEST_WS, { connectorId: 'salesforce', syncJobId: 'job-2' });

    const record = await svc.getLineage('entity:001', TEST_WS);
    expect(record!.sourceConnectorId).toBe('salesforce');
    expect(record!.sourceSyncJobId).toBe('job-2');
  });

  it('records sourceApiTimestamp correctly', async () => {
    const ts = new Date('2026-01-15T10:00:00Z');
    await svc.recordOrigin('entity:002', TEST_WS, {
      connectorId: 'hubspot',
      sourceApiTimestamp: ts,
    });

    const record = await svc.getLineage('entity:002', TEST_WS);
    expect(record!.sourceApiTimestamp).toBeDefined();
    expect(record!.sourceApiTimestamp!.toISOString()).toBe(ts.toISOString());
  });

  // ---------------------------------------------------------------------------
  // addTransformation
  // ---------------------------------------------------------------------------

  it('appends a transformation step to lineage', async () => {
    await svc.recordOrigin('entity:001', TEST_WS, { connectorId: 'hubspot' });
    await svc.addTransformation('entity:001', TEST_WS, {
      type: 'embedding',
      timestamp: new Date().toISOString(),
      metadata: { model: 'text-embedding-3-small' },
    });

    const record = await svc.getLineage('entity:001', TEST_WS);
    expect(record!.transformations).toHaveLength(1);
    expect(record!.transformations[0]!.type).toBe('embedding');
  });

  it('accumulates multiple transformations in order', async () => {
    await svc.recordOrigin('entity:001', TEST_WS, { connectorId: 'hubspot' });

    const types = ['embedding', 'pii_masking', 'deduplication'] as const;
    for (const type of types) {
      await svc.addTransformation('entity:001', TEST_WS, {
        type,
        timestamp: new Date().toISOString(),
      });
    }

    const record = await svc.getLineage('entity:001', TEST_WS);
    expect(record!.transformations).toHaveLength(3);
    expect(record!.transformations.map((t) => t.type)).toEqual(types);
  });

  it('creates a stub record for transformation on entity with no prior origin', async () => {
    await svc.addTransformation('entity:orphan', TEST_WS, {
      type: 'enrichment',
      timestamp: new Date().toISOString(),
    });

    const record = await svc.getLineage('entity:orphan', TEST_WS);
    expect(record).not.toBeNull();
    expect(record!.sourceConnectorId).toBe('unknown');
    expect(record!.transformations[0]?.type).toBe('enrichment');
  });

  // ---------------------------------------------------------------------------
  // listEntityLineage
  // ---------------------------------------------------------------------------

  it('lists lineage records for workspace in recency order', async () => {
    for (let i = 1; i <= 5; i++) {
      await svc.recordOrigin(`entity:${i}`, TEST_WS, { connectorId: 'hubspot' });
    }

    const records = await svc.listEntityLineage(TEST_WS, 10);
    expect(records).toHaveLength(5);
    // Should be descending by last_modified_at
    for (let i = 1; i < records.length; i++) {
      expect(records[i - 1]!.lastModifiedAt.getTime()).toBeGreaterThanOrEqual(
        records[i]!.lastModifiedAt.getTime(),
      );
    }
  });

  it('supports cursor-based pagination', async () => {
    for (let i = 1; i <= 6; i++) {
      await svc.recordOrigin(`entity:page:${i}`, TEST_WS, { connectorId: 'hubspot' });
    }

    const page1 = await svc.listEntityLineage(TEST_WS, 3);
    expect(page1).toHaveLength(3);

    const cursor = page1.at(-1)!.lastModifiedAt.toISOString();
    const page2 = await svc.listEntityLineage(TEST_WS, 3, cursor);
    expect(page2.length).toBeGreaterThan(0);

    const allIds = [...page1.map((r) => r.entityId), ...page2.map((r) => r.entityId)];
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  // ---------------------------------------------------------------------------
  // recordOriginBatch
  // ---------------------------------------------------------------------------

  it('bulk-records origins for 1000 entities efficiently', async () => {
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      entityId: `batch:entity:${i}`,
      workspaceId: TEST_WS,
      origin: { connectorId: 'salesforce', syncJobId: `batch-job` },
    }));

    const start = Date.now();
    await svc.recordOriginBatch(entries);
    const elapsed = Date.now() - start;

    const records = await svc.listEntityLineage(TEST_WS, 200);
    expect(records.length).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(10_000); // Should complete in < 10 seconds
  });

  // ---------------------------------------------------------------------------
  // recordDependency + computeImpact
  // ---------------------------------------------------------------------------

  it('records a dependency edge and retrieves impact', async () => {
    await svc.recordOrigin('parent:001', TEST_WS, { connectorId: 'hubspot' });
    await svc.recordOrigin('child:001', TEST_WS, { connectorId: 'hubspot' });

    const depResult = await svc.recordDependency('child:001', 'parent:001', TEST_WS, 'derived_from');
    expect(depResult.isOk()).toBe(true);

    const impact = await svc.computeImpact('parent:001', TEST_WS);
    expect(impact.isOk()).toBe(true);
    expect(impact.value!.affectedEntityIds).toContain('child:001');
    expect(impact.value!.affectedCount).toBeGreaterThanOrEqual(1);
  });

  it('computes multi-hop impact analysis', async () => {
    // root → child → grandchild
    const entities = ['root:1', 'child:1', 'grandchild:1'];
    for (const e of entities) {
      await svc.recordOrigin(e, TEST_WS, { connectorId: 'hubspot' });
    }
    await svc.recordDependency('child:1', 'root:1', TEST_WS, 'derived_from');
    await svc.recordDependency('grandchild:1', 'child:1', TEST_WS, 'derived_from');

    const impact = await svc.computeImpact('root:1', TEST_WS, 3);
    expect(impact.isOk()).toBe(true);
    expect(impact.value!.affectedEntityIds).toContain('child:1');
    expect(impact.value!.affectedEntityIds).toContain('grandchild:1');
  });

  it('returns empty impact for entity with no dependents', async () => {
    await svc.recordOrigin('isolated:001', TEST_WS, { connectorId: 'hubspot' });

    const impact = await svc.computeImpact('isolated:001', TEST_WS);
    expect(impact.isOk()).toBe(true);
    expect(impact.value!.affectedCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // getLineageGraph
  // ---------------------------------------------------------------------------

  it('builds lineage graph with ancestors and descendants', async () => {
    const ids = ['ancestor:1', 'middle:1', 'descendant:1'];
    for (const id of ids) {
      await svc.recordOrigin(id, TEST_WS, { connectorId: 'hubspot' });
    }
    await svc.recordDependency('middle:1', 'ancestor:1', TEST_WS, 'derived_from');
    await svc.recordDependency('descendant:1', 'middle:1', TEST_WS, 'derived_from');

    const graphResult = await svc.getLineageGraph('middle:1', TEST_WS);
    expect(graphResult.isOk()).toBe(true);
    const graph = graphResult.value!;

    expect(graph.ancestors.some((a) => a.entityId === 'ancestor:1')).toBe(true);
    expect(graph.descendants.some((d) => d.entityId === 'descendant:1')).toBe(true);
    expect(graph.ancestors[0]?.depth).toBe(1);
  });

  it('handles orphan entity with no relationships in lineage graph', async () => {
    await svc.recordOrigin('orphan:graph:1', TEST_WS, { connectorId: 'hubspot' });
    const result = await svc.getLineageGraph('orphan:graph:1', TEST_WS);
    expect(result.isOk()).toBe(true);
    expect(result.value!.ancestors).toHaveLength(0);
    expect(result.value!.descendants).toHaveLength(0);
  });

  it('returns null for getLineage on unknown entity', async () => {
    const record = await svc.getLineage('does-not-exist', TEST_WS);
    expect(record).toBeNull();
  });
});
