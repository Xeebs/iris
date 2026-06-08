import { describe, it, expect, vi } from 'vitest';
import {
  captureContextSnapshot,
  queryAsOfDate,
  diffContextVersions,
  listVersionHistory,
  rollbackToVersion,
} from '../context-versioner';

type Sql = Parameters<typeof captureContextSnapshot>[0];

describe('captureContextSnapshot', () => {
  it('returns a snapshot with correct metadata', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([
        { id: 'e1', type: 'contact', label: 'Alice', attributes: {}, last_modified: '2026-06-01T00:00:00Z' },
        { id: 'e2', type: 'deal', label: 'Q1', attributes: {}, last_modified: '2026-06-01T00:00:00Z' },
      ])
      .mockResolvedValueOnce([{ snapshot_id: 'snap1', captured_at: '2026-06-08T10:00:00Z' }]);

    const result = await captureContextSnapshot(sql as unknown as Sql, 'ws1', 'before-migration');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.entityCount).toBe(2);
      expect(result.value.snapshotKey).toBe('before-migration');
      expect(result.value.checksum).toHaveLength(64);
      expect(result.value.gzipSizeBytes).toBeGreaterThan(0);
      expect(result.value.gzipSizeBytes).toBeLessThan(result.value.dataSizeBytes);
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await captureContextSnapshot(sql as unknown as Sql, 'ws1', 'snap');
    expect(result.isErr()).toBe(true);
  });

  it('handles empty entity set', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ snapshot_id: 'snap2', captured_at: '2026-06-08T10:00:00Z' }]);
    const result = await captureContextSnapshot(sql as unknown as Sql, 'ws-empty', 'empty-snap');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.entityCount).toBe(0);
    }
  });
});

describe('queryAsOfDate', () => {
  it('returns empty result when no snapshot exists before target date', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]); // no snapshot found
    const result = await queryAsOfDate(sql as unknown as Sql, 'ws1', 'contacts', new Date('2020-01-01'), 2000);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.entities).toHaveLength(0);
      expect(result.value.snapshotId).toBe('');
    }
  });

  it('returns entities from historical query', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ snapshot_id: 'snap1', captured_at: '2026-06-01T00:00:00Z' }])
      .mockResolvedValueOnce([
        { id: 'e1', type: 'contact', label: 'Alice', attributes: {}, last_modified: '2026-05-30T00:00:00Z' },
      ]);
    const result = await queryAsOfDate(sql as unknown as Sql, 'ws1', 'contact', new Date('2026-06-02'), 2000);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.snapshotId).toBe('snap1');
      expect(result.value.entities).toHaveLength(1);
      expect(result.value.entities[0]!.type).toBe('contact');
    }
  });

  it('truncates when over budget', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ snapshot_id: 'snap1', captured_at: '2026-06-01T00:00:00Z' }])
      .mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, i) => ({
          id: String(i), type: 'contact',
          label: 'X'.repeat(200) + i, attributes: {}, last_modified: '2026-05-30T00:00:00Z',
        }))
      );
    const result = await queryAsOfDate(sql as unknown as Sql, 'ws1', 'contacts', new Date('2026-06-02'), 200);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.truncated).toBe(true);
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await queryAsOfDate(sql as unknown as Sql, 'ws1', 'q', new Date(), 2000);
    expect(result.isErr()).toBe(true);
  });
});

describe('diffContextVersions', () => {
  it('returns cached diff when available', async () => {
    const cachedDiff = {
      changed_entity_ids: '["e1","e2"]',
      change_types: '["created","updated"]',
      diff_summary: '{"created":1,"updated":1,"deleted":0,"totalChanges":2}',
    };
    const sql = vi.fn().mockResolvedValueOnce([cachedDiff]);
    const result = await diffContextVersions(sql as unknown as Sql, 'ws1', 'snap1', 'snap2');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.changedEntityIds).toEqual(['e1', 'e2']);
      expect(result.value.diffSummary.totalChanges).toBe(2);
      expect(sql).toHaveBeenCalledOnce();
    }
  });

  it('computes diff when not cached', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([]) // no cache
      .mockResolvedValueOnce([{ snapshot_id: 'snap1', captured_at: '2026-06-01T00:00:00Z' }]) // from snap
      .mockResolvedValueOnce([{ snapshot_id: 'snap2', captured_at: '2026-06-08T00:00:00Z' }]) // to snap
      .mockResolvedValueOnce([{ id: 'e3' }]) // created
      .mockResolvedValueOnce([{ id: 'e1' }]) // updated
      .mockResolvedValue([]); // cache insert

    const result = await diffContextVersions(sql as unknown as Sql, 'ws1', 'snap1', 'snap2');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.diffSummary.created).toBe(1);
      expect(result.value.diffSummary.updated).toBe(1);
      expect(result.value.diffSummary.totalChanges).toBe(2);
    }
  });

  it('returns Err when snapshot not found', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([]) // no cache
      .mockResolvedValueOnce([]) // from snap not found
      .mockResolvedValueOnce([]); // to snap
    const result = await diffContextVersions(sql as unknown as Sql, 'ws1', 'missing', 'snap2');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await diffContextVersions(sql as unknown as Sql, 'ws1', 's1', 's2');
    expect(result.isErr()).toBe(true);
  });
});

describe('listVersionHistory', () => {
  it('returns paginated snapshot list', async () => {
    const sql = vi.fn().mockResolvedValue([
      { snapshot_id: 'snap3', snapshot_key: 'v3', captured_at: '2026-06-08T00:00:00Z', entity_count: 150, data_size_bytes: 50000 },
      { snapshot_id: 'snap2', snapshot_key: 'v2', captured_at: '2026-06-05T00:00:00Z', entity_count: 120, data_size_bytes: 40000 },
      { snapshot_id: 'snap1', snapshot_key: 'v1', captured_at: '2026-06-01T00:00:00Z', entity_count: 100, data_size_bytes: 35000 },
    ]);
    const result = await listVersionHistory(sql as unknown as Sql, 'ws1', 20);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.entries).toHaveLength(3);
      expect(result.value.hasMore).toBe(false);
      expect(result.value.nextCursor).toBeNull();
    }
  });

  it('sets hasMore and nextCursor when more pages exist', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      snapshot_id: `snap${i}`,
      snapshot_key: `v${i}`,
      captured_at: '2026-06-08T00:00:00Z',
      entity_count: 100,
      data_size_bytes: 30000,
    }));
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await listVersionHistory(sql as unknown as Sql, 'ws1', 5);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.entries).toHaveLength(5);
      expect(result.value.hasMore).toBe(true);
      expect(result.value.nextCursor).toBe('snap4');
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await listVersionHistory(sql as unknown as Sql, 'ws1');
    expect(result.isErr()).toBe(true);
  });
});

describe('rollbackToVersion', () => {
  it('returns rollback date and entity count on success', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ snapshot_id: 'snap1', captured_at: '2026-06-01T00:00:00Z', entity_count: 100 }])
      .mockResolvedValue([]);
    const result = await rollbackToVersion(sql as unknown as Sql, 'ws1', 'snap1', 'admin-user');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.entityCount).toBe(100);
      expect(result.value.rolledBackTo).toBeInstanceOf(Date);
    }
  });

  it('returns Err when snapshot not found', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]);
    const result = await rollbackToVersion(sql as unknown as Sql, 'ws1', 'nonexistent', 'admin');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('transaction failed'));
    const result = await rollbackToVersion(sql as unknown as Sql, 'ws1', 'snap1', 'admin');
    expect(result.isErr()).toBe(true);
  });
});
