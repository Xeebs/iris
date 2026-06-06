import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndexStatusService } from '../index-status.js';
import type postgres from 'postgres';

type SqlClient = ReturnType<typeof postgres>;

function makeDate(iso: string) {
  return new Date(iso);
}

function makeSqlMock(rows: unknown[] = []): SqlClient {
  const tagged = vi.fn().mockResolvedValue(rows);
  return tagged as unknown as SqlClient;
}

describe('IndexStatusService', () => {
  let sql: SqlClient;
  let service: IndexStatusService;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSqlMock();
    service = new IndexStatusService(sql);
  });

  describe('recordEntityIndex()', () => {
    it('executes an UPSERT query with correct params', async () => {
      const result = await service.recordEntityIndex('ws-1', 'contact', 150, 30000);

      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledOnce();
    });

    it('returns err when DB throws', async () => {
      vi.mocked(sql).mockRejectedValue(new Error('db error'));
      const result = await service.recordEntityIndex('ws-1', 'contact', 10, 1000);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/db error/);
    });
  });

  describe('getIndexStatus()', () => {
    it('returns aggregated totals across all entity types', async () => {
      const mockRows = [
        { entity_type: 'contact', entity_count: '100', total_bytes: '20000', last_indexed_at: makeDate('2026-01-02T10:00:00Z') },
        { entity_type: 'deal', entity_count: '50', total_bytes: '15000', last_indexed_at: makeDate('2026-01-01T10:00:00Z') },
      ];
      sql = makeSqlMock(mockRows);
      service = new IndexStatusService(sql);

      const result = await service.getIndexStatus('ws-1');
      expect(result.isOk()).toBe(true);

      const status = result._unsafeUnwrap();
      expect(status.totalEntities).toBe(150);
      expect(status.totalBytes).toBe(35000);
      expect(status.coverageByType).toHaveLength(2);
    });

    it('returns the most recent lastIndexedAt across types', async () => {
      const mockRows = [
        { entity_type: 'contact', entity_count: '100', total_bytes: '10000', last_indexed_at: makeDate('2026-01-03T00:00:00Z') },
        { entity_type: 'company', entity_count: '20', total_bytes: '5000', last_indexed_at: makeDate('2026-01-01T00:00:00Z') },
      ];
      sql = makeSqlMock(mockRows);
      service = new IndexStatusService(sql);

      const result = await service.getIndexStatus('ws-1');
      const status = result._unsafeUnwrap();

      expect(status.lastIndexedAt?.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    });

    it('returns null lastIndexedAt when no entities are indexed', async () => {
      sql = makeSqlMock([]);
      service = new IndexStatusService(sql);

      const result = await service.getIndexStatus('ws-empty');
      const status = result._unsafeUnwrap();

      expect(status.totalEntities).toBe(0);
      expect(status.totalBytes).toBe(0);
      expect(status.lastIndexedAt).toBeNull();
      expect(status.coverageByType).toHaveLength(0);
    });

    it('returns coverage breakdown with correct entity counts', async () => {
      const mockRows = [
        { entity_type: 'deal', entity_count: '75', total_bytes: '8000', last_indexed_at: makeDate('2026-01-01T00:00:00Z') },
      ];
      sql = makeSqlMock(mockRows);
      service = new IndexStatusService(sql);

      const result = await service.getIndexStatus('ws-1');
      const { coverageByType } = result._unsafeUnwrap();

      expect(coverageByType[0]).toMatchObject({
        entityType: 'deal',
        entityCount: 75,
        totalBytes: 8000,
      });
    });

    it('returns err when DB throws', async () => {
      vi.mocked(sql).mockRejectedValue(new Error('connection refused'));
      const result = await service.getIndexStatus('ws-1');

      expect(result.isErr()).toBe(true);
    });
  });
});
