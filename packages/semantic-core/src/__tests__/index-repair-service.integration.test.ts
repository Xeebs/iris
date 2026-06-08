/**
 * Integration tests for IndexRepairService.
 * Requires Postgres running (docker-compose up -d).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { IndexRepairService } from '../index-repair-service.js';

const TEST_WS = 'repair-integration-test';
let sql: ReturnType<typeof postgres>;
let service: IndexRepairService;

beforeAll(async () => {
  const url = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(url);
  service = new IndexRepairService(sql as unknown as ConstructorParameters<typeof IndexRepairService>[0]);

  await sql`DELETE FROM rebuild_jobs WHERE workspace_id = ${TEST_WS}`.catch(() => {});
  await sql`DELETE FROM integrity_scans WHERE workspace_id = ${TEST_WS}`.catch(() => {});
});

afterAll(async () => {
  await sql`DELETE FROM rebuild_jobs WHERE workspace_id = ${TEST_WS}`.catch(() => {});
  await sql`DELETE FROM integrity_scans WHERE workspace_id = ${TEST_WS}`.catch(() => {});
  await sql.end();
});

describe('IndexRepairService integration', () => {
  it('runs a full integrity scan against the real DB', async () => {
    const result = await service.scanIndexIntegrity(TEST_WS);
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(typeof report.totalEntitiesScanned).toBe('number');
    expect(Array.isArray(report.issues)).toBe(true);
  });

  it('stores scan in integrity_scans table', async () => {
    await service.scanIndexIntegrity(TEST_WS);
    const scans = await service.listScans(TEST_WS);
    expect(scans.isOk()).toBe(true);
    expect(scans._unsafeUnwrap().length).toBeGreaterThanOrEqual(1);
  });

  it('reports the latest scan via reportCorruption', async () => {
    const report = await service.reportCorruption(TEST_WS);
    expect(report.isOk()).toBe(true);
  });

  it('estimates entity count in dry-run rebuild', async () => {
    const result = await service.rebuildIndex(TEST_WS, { dryRun: true });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().status).toBe('dry_run');
    expect(typeof result._unsafeUnwrap().estimatedEntities).toBe('number');
  });

  it('completes a full rebuild and persists job record', async () => {
    const result = await service.rebuildIndex(TEST_WS);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().status).toBe('completed');

    const jobs = await service.listRebuildJobs(TEST_WS);
    expect(jobs.isOk()).toBe(true);
    expect(jobs._unsafeUnwrap().length).toBeGreaterThanOrEqual(1);
  });
});
