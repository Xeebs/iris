import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndexRepairService } from '../index-repair-service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSql(defaultResult: unknown[] = []) {
  // services call sql.json() for jsonb params; echo the value through
  const fn = Object.assign(vi.fn().mockResolvedValue(defaultResult), { json: (v: unknown) => v });
  return fn as unknown as ConstructorParameters<typeof IndexRepairService>[0];
}

const WS = 'ws-repair-test';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IndexRepairService', () => {
  let service: IndexRepairService;
  let sql: ReturnType<typeof makeSql>;

  beforeEach(() => {
    sql = makeSql();
    service = new IndexRepairService(sql);
  });

  // ── scanIndexIntegrity ────────────────────────────────────────────────────

  describe('scanIndexIntegrity', () => {
    it('returns healthy report when no issues found', async () => {
      sql
        .mockResolvedValueOnce([]) // INSERT integrity_scans
        .mockResolvedValueOnce([{ id: 'e:1' }, { id: 'e:2' }]) // entity rows
        .mockResolvedValueOnce([{ entity_id: 'e:1' }, { entity_id: 'e:2' }]) // vector rows
        .mockResolvedValueOnce([]) // relationship rows
        .mockResolvedValueOnce([]); // UPDATE

      const result = await service.scanIndexIntegrity(WS);
      expect(result.isOk()).toBe(true);
      const report = result._unsafeUnwrap();
      expect(report.isHealthy).toBe(true);
      expect(report.issues.length).toBe(0);
      expect(report.totalEntitiesScanned).toBe(2);
    });

    it('detects orphaned vectors (vector with no entity row)', async () => {
      sql
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'e:1' }]) // 1 entity
        .mockResolvedValueOnce([{ entity_id: 'e:1' }, { entity_id: 'ghost' }]) // 2 vectors
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.scanIndexIntegrity(WS);
      const report = result._unsafeUnwrap();
      expect(report.orphanedVectorCount).toBe(1);
      expect(report.issues.find(i => i.issueType === 'orphaned_vector')?.entityId).toBe('ghost');
      expect(report.isHealthy).toBe(false);
    });

    it('detects missing vectors (entity with no vector row)', async () => {
      sql
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'e:1' }, { id: 'e:2' }])
        .mockResolvedValueOnce([{ entity_id: 'e:1' }]) // only 1 vector
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.scanIndexIntegrity(WS);
      const report = result._unsafeUnwrap();
      expect(report.missingVectorCount).toBe(1);
      expect(report.issues.find(i => i.issueType === 'missing_vector')?.entityId).toBe('e:2');
    });

    it('detects broken relationships (target entity missing)', async () => {
      sql
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'e:1' }])
        .mockResolvedValueOnce([{ entity_id: 'e:1' }])
        .mockResolvedValueOnce([{ source_id: 'e:1', target_id: 'e:missing' }])
        .mockResolvedValueOnce([]);

      const result = await service.scanIndexIntegrity(WS);
      const report = result._unsafeUnwrap();
      expect(report.brokenRelationshipCount).toBe(1);
      expect(report.issues.find(i => i.issueType === 'broken_relationship')?.entityId).toBe('e:1');
    });

    it('calls progress callback with increasing percentages', async () => {
      const progress: number[] = [];
      sql
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.scanIndexIntegrity(WS, pct => progress.push(pct));
      expect(progress[0]).toBe(10);
      expect(progress[progress.length - 1]).toBe(100);
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
    });

    it('returns err when DB query fails', async () => {
      sql
        .mockResolvedValueOnce([]) // INSERT
        .mockRejectedValueOnce(new Error('DB timeout')); // SELECT entities

      const result = await service.scanIndexIntegrity(WS);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/DB timeout/);
    });
  });

  // ── reportCorruption ──────────────────────────────────────────────────────

  describe('reportCorruption', () => {
    it('returns null when no scan exists', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await service.reportCorruption(WS);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns the latest report when scan exists', async () => {
      const fakeReport = {
        workspaceId: WS,
        isHealthy: true,
        issues: [],
        totalEntitiesScanned: 50,
        orphanedVectorCount: 0,
        missingVectorCount: 0,
        brokenRelationshipCount: 0,
        scannedAt: new Date().toISOString(),
      };
      sql.mockResolvedValueOnce([{ report_json: fakeReport }]);
      const result = await service.reportCorruption(WS);
      expect(result._unsafeUnwrap()?.isHealthy).toBe(true);
    });
  });

  // ── rebuildIndex ──────────────────────────────────────────────────────────

  describe('rebuildIndex', () => {
    it('returns dry_run status without inserting rebuild job', async () => {
      sql.mockResolvedValueOnce([{ total: 300 }]);
      const result = await service.rebuildIndex(WS, { dryRun: true });
      expect(result.isOk()).toBe(true);
      const rb = result._unsafeUnwrap();
      expect(rb.status).toBe('dry_run');
      expect(rb.isDryRun).toBe(true);
      expect(rb.estimatedEntities).toBe(300);
      expect(sql).toHaveBeenCalledTimes(1);
    });

    it('runs full rebuild and returns completed status', async () => {
      sql
        .mockResolvedValueOnce([{ total: 10 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'e:1' }, { id: 'e:2' }])
        .mockResolvedValueOnce([]);

      const result = await service.rebuildIndex(WS);
      const rb = result._unsafeUnwrap();
      expect(rb.status).toBe('completed');
      expect(rb.reindexedCount).toBe(2);
    });

    it('filters by entityType when provided', async () => {
      sql
        .mockResolvedValueOnce([{ total: 5 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'c:1' }])
        .mockResolvedValueOnce([]);

      const result = await service.rebuildIndex(WS, { entityTypeFilter: 'contact' });
      const rb = result._unsafeUnwrap();
      expect(rb.entityTypeFilter).toBe('contact');
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValueOnce(new Error('connection lost'));
      const result = await service.rebuildIndex(WS);
      expect(result.isErr()).toBe(true);
    });
  });

  // ── rollbackIndexSnapshot ─────────────────────────────────────────────────

  describe('rollbackIndexSnapshot', () => {
    it('returns not-found error for unknown snapshot', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await service.rollbackIndexSnapshot(WS, 'snap-unknown');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/not found/i);
    });

    it('returns rolledBack=true for valid snapshot', async () => {
      sql
        .mockResolvedValueOnce([{ entity_count: 120 }])
        .mockResolvedValueOnce([]);
      const result = await service.rollbackIndexSnapshot(WS, 'snap-valid');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().rolledBack).toBe(true);
      expect(result._unsafeUnwrap().restoredEntities).toBe(120);
    });
  });

  // ── listScans ─────────────────────────────────────────────────────────────

  describe('listScans', () => {
    it('returns empty array when no scans', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await service.listScans(WS);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('maps rows to ScanStatus objects', async () => {
      sql.mockResolvedValueOnce([
        {
          scan_id: 'scan-1',
          workspace_id: WS,
          status: 'completed',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          issue_count: 3,
        },
      ]);
      const result = await service.listScans(WS);
      const scans = result._unsafeUnwrap();
      expect(scans.length).toBe(1);
      expect(scans[0]?.status).toBe('completed');
      expect(scans[0]?.issueCount).toBe(3);
    });
  });

  // ── listRebuildJobs ───────────────────────────────────────────────────────

  describe('listRebuildJobs', () => {
    it('maps rows to RebuildResult objects', async () => {
      sql.mockResolvedValueOnce([
        {
          job_id: 'job-1',
          workspace_id: WS,
          entity_type_filter: null,
          status: 'completed',
          estimated_entities: 200,
          reindexed_count: 198,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ]);
      const result = await service.listRebuildJobs(WS);
      const jobs = result._unsafeUnwrap();
      expect(jobs.length).toBe(1);
      expect(jobs[0]?.reindexedCount).toBe(198);
    });
  });
});
