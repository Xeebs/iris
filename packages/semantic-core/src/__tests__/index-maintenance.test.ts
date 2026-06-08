import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndexMaintenanceService } from '../index-maintenance.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

type Responses = Array<unknown[]>;

function makeSql(...responses: Responses) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? [];
    return Promise.resolve(r);
  });
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    workspace_id: 'ws-1',
    job_type: 'deduplicate',
    status: 'completed',
    started_at: '2026-06-01T02:00:00.000Z',
    completed_at: '2026-06-01T02:01:00.000Z',
    duration_ms: '60000',
    records_affected: '5',
    error_message: null,
    created_at: '2026-06-01T02:00:00.000Z',
    ...overrides,
  };
}

describe('IndexMaintenanceService', () => {
  describe('deduplicateIndex', () => {
    it('returns dedup result with no duplicates when table is empty', async () => {
      const sql = makeSql([{ id: 'job-1' }], [], [], []);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.deduplicateIndex('ws-1');
      expect(result.isOk()).toBe(true);
      const val = result._unsafeUnwrap();
      expect(val.scanned).toBe(0);
      expect(val.entitiesRemoved).toBe(0);
    });

    it('removes duplicates above threshold', async () => {
      const dupeRows = [
        { entity_id_a: 'e-1', entity_id_b: 'e-2', similarity: 0.05 },
        { entity_id_a: 'e-1', entity_id_b: 'e-3', similarity: 0.04 },
      ];
      const sql = makeSql([{ id: 'job-1' }], dupeRows, [], []);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.deduplicateIndex('ws-1');
      expect(result.isOk()).toBe(true);
      const val = result._unsafeUnwrap();
      expect(val.scanned).toBe(2);
      expect(val.entitiesRemoved).toBe(2);
    });

    it('does not remove entity_id_a when already in remove set', async () => {
      const dupeRows = [
        { entity_id_a: 'e-1', entity_id_b: 'e-2', similarity: 0.05 },
        { entity_id_a: 'e-3', entity_id_b: 'e-2', similarity: 0.04 },
      ];
      const sql = makeSql([{ id: 'job-1' }], dupeRows, [], []);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.deduplicateIndex('ws-1');
      const val = result._unsafeUnwrap();
      expect(val.entitiesRemoved).toBe(1);
    });

    it('records failed job on sql error', async () => {
      const failSql = vi.fn()
        .mockResolvedValueOnce([{ id: 'job-1' }])
        .mockRejectedValueOnce(new Error('DB fail'))
        .mockResolvedValue([]);  // fallback for failJob UPDATE call
      (failSql as unknown as Record<string, unknown>).array = vi.fn();
      const svc = new IndexMaintenanceService(failSql as unknown as ReturnType<typeof import('postgres').default>);
      const result = await svc.deduplicateIndex('ws-1');
      expect(result.isErr()).toBe(true);
    });

    it('returns err if job creation fails', async () => {
      const sql = makeSql([]);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.deduplicateIndex('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('pruneStaleEntities', () => {
    it('returns pruned count', async () => {
      const sql = makeSql([{ id: 'job-1' }], [{ count: '15' }], [], []);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.pruneStaleEntities('ws-1', 60);
      expect(result.isOk()).toBe(true);
      const val = result._unsafeUnwrap();
      expect(val.pruned).toBe(15);
      expect(val.bytesFreed).toBe(15 * 6144);
    });

    it('returns zero when nothing stale', async () => {
      const sql = makeSql([{ id: 'job-1' }], [{ count: '0' }], [], []);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.pruneStaleEntities('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().pruned).toBe(0);
    });
  });

  describe('rebalanceVectorIndex', () => {
    it('returns ok on success', async () => {
      const sql = makeSql([{ id: 'job-1' }], [], []);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.rebalanceVectorIndex('ws-1');
      expect(result.isOk()).toBe(true);
    });

    it('returns err if job creation fails', async () => {
      const sql = makeSql([]);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.rebalanceVectorIndex('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('validateIndexIntegrity', () => {
    it('returns integrity report', async () => {
      const sql = makeSql(
        [{ id: 'job-1' }],
        [{ count: '3' }],
        [{ count: '1' }],
        [{ count: '5' }],
        [],
      );
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.validateIndexIntegrity('ws-1');
      expect(result.isOk()).toBe(true);
      const val = result._unsafeUnwrap();
      expect(val.orphanedEntities).toBe(3);
      expect(val.brokenRelationships).toBe(1);
      expect(val.missingEmbeddings).toBe(5);
      expect(val.repaired).toBe(0);
    });

    it('handles zero-issue workspace', async () => {
      const sql = makeSql(
        [{ id: 'job-1' }],
        [{ count: '0' }],
        [{ count: '0' }],
        [{ count: '0' }],
        [],
      );
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.validateIndexIntegrity('ws-1');
      expect(result.isOk()).toBe(true);
      const val = result._unsafeUnwrap();
      expect(val.orphanedEntities).toBe(0);
      expect(val.brokenRelationships).toBe(0);
    });
  });

  describe('getIndexHealth', () => {
    it('returns full health report', async () => {
      const sql = makeSql(
        [{ count: '1000' }],
        [{ count: '20' }],
        [{ count: '50' }],
        [{ completed_at: '2026-05-01T00:00:00.000Z' }],
      );
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.getIndexHealth('ws-1');
      expect(result.isOk()).toBe(true);
      const report = result._unsafeUnwrap();
      expect(report.totalEntities).toBe(1000);
      expect(report.orphanedEntities).toBe(20);
      expect(report.staleEntities).toBe(50);
      expect(report.healthScore).toBeGreaterThanOrEqual(0);
      expect(report.healthScore).toBeLessThanOrEqual(100);
      expect(report.lastMaintenanceAt).toBeInstanceOf(Date);
    });

    it('handles empty workspace gracefully', async () => {
      const sql = makeSql(
        [{ count: '0' }],
        [{ count: '0' }],
        [{ count: '0' }],
        [],
      );
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.getIndexHealth('ws-empty');
      expect(result.isOk()).toBe(true);
      const report = result._unsafeUnwrap();
      expect(report.totalEntities).toBe(0);
      expect(report.healthScore).toBe(100);
      expect(report.lastMaintenanceAt).toBeNull();
    });

    it('computes health score correctly', async () => {
      const sql = makeSql(
        [{ count: '100' }],
        [{ count: '10' }],
        [{ count: '0' }],
        [],
      );
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.getIndexHealth('ws-1');
      const report = result._unsafeUnwrap();
      expect(report.healthScore).toBe(90);
    });
  });

  describe('listJobs', () => {
    it('returns jobs list', async () => {
      const sql = makeSql([makeJobRow(), makeJobRow({ id: 'job-2', job_type: 'prune_stale' })]);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.listJobs('ws-1');
      expect(result.isOk()).toBe(true);
      const jobs = result._unsafeUnwrap();
      expect(jobs).toHaveLength(2);
      expect(jobs[0]?.id).toBe('job-1');
      expect(jobs[1]?.jobType).toBe('prune_stale');
    });

    it('returns empty array when no jobs', async () => {
      const sql = makeSql([]);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.listJobs('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('maps all fields correctly', async () => {
      const sql = makeSql([makeJobRow({ status: 'failed', error_message: 'Out of memory' })]);
      const svc = new IndexMaintenanceService(sql);
      const result = await svc.listJobs('ws-1');
      const job = result._unsafeUnwrap()[0]!;
      expect(job.status).toBe('failed');
      expect(job.errorMessage).toBe('Out of memory');
      expect(job.startedAt).toBeInstanceOf(Date);
      expect(job.completedAt).toBeInstanceOf(Date);
    });

    it('returns err on db failure', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('connection lost'));
      (fn as unknown as Record<string, unknown>).array = vi.fn();
      const svc = new IndexMaintenanceService(fn as unknown as ReturnType<typeof import('postgres').default>);
      const result = await svc.listJobs('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });
});
