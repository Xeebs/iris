/**
 * Integration tests for IndexStatusService — require real Postgres.
 * Run with: pnpm test:integration (after docker-compose up -d)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { IndexStatusService } from '../index-status.js';

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/iris_test';

describe.skipIf(!process.env['INTEGRATION'])('IndexStatusService — integration', () => {
  let sql: ReturnType<typeof postgres>;
  let service: IndexStatusService;
  const workspaceId = `test-index-${Date.now()}`;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL);
    await sql`
      CREATE TABLE IF NOT EXISTS index_status (
        id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id    TEXT         NOT NULL,
        entity_type     TEXT         NOT NULL,
        entity_count    INTEGER      NOT NULL DEFAULT 0,
        total_bytes     BIGINT       NOT NULL DEFAULT 0,
        last_indexed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT index_status_unique UNIQUE (workspace_id, entity_type)
      )
    `;
    service = new IndexStatusService(sql);
  });

  afterAll(async () => {
    await sql`DELETE FROM index_status WHERE workspace_id = ${workspaceId}`;
    await sql.end();
  });

  it('records entity index counts and retrieves status', async () => {
    const recordResult = await service.recordEntityIndex(workspaceId, 'contact', 100, 20000);
    expect(recordResult.isOk()).toBe(true);

    const statusResult = await service.getIndexStatus(workspaceId);
    expect(statusResult.isOk()).toBe(true);

    const status = statusResult._unsafeUnwrap();
    expect(status.totalEntities).toBe(100);
    expect(status.totalBytes).toBe(20000);
    expect(status.coverageByType).toHaveLength(1);
    expect(status.coverageByType[0]?.entityType).toBe('contact');
  });

  it('upserts on second record for same entity type', async () => {
    await service.recordEntityIndex(workspaceId, 'deal', 50, 10000);
    await service.recordEntityIndex(workspaceId, 'deal', 80, 15000);

    const statusResult = await service.getIndexStatus(workspaceId);
    const status = statusResult._unsafeUnwrap();

    const dealCoverage = status.coverageByType.find((c) => c.entityType === 'deal');
    expect(dealCoverage?.entityCount).toBe(80);
    expect(dealCoverage?.totalBytes).toBe(15000);
  });

  it('aggregates across multiple entity types', async () => {
    await service.recordEntityIndex(workspaceId, 'company', 30, 5000);

    const statusResult = await service.getIndexStatus(workspaceId);
    const status = statusResult._unsafeUnwrap();

    const types = status.coverageByType.map((c) => c.entityType);
    expect(types).toContain('contact');
    expect(types).toContain('deal');
    expect(types).toContain('company');
    expect(status.totalEntities).toBeGreaterThan(0);
  });

  it('returns null lastIndexedAt for workspace with no data', async () => {
    const emptyResult = await service.getIndexStatus(`nonexistent-${Date.now()}`);
    const status = emptyResult._unsafeUnwrap();

    expect(status.totalEntities).toBe(0);
    expect(status.lastIndexedAt).toBeNull();
    expect(status.coverageByType).toHaveLength(0);
  });
});
