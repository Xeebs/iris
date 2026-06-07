import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndexSnapshotService } from '../index-snapshot.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Mock filesystem operations
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
  unlink: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
}));

vi.mock('stream/promises', () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('zlib', () => ({
  createGzip: vi.fn().mockReturnValue({}),
  createGunzip: vi.fn().mockReturnValue({}),
}));

const SNAPSHOT_ROW = {
  id: 'snap-uuid-1',
  workspace_id: 'ws-1',
  status: 'ready',
  entity_count: 50,
  snapshot_size_bytes: 2048,
  storage_path: '/tmp/iris-snapshots/ws-1-snap-uuid-1.json.gz',
  retention_days: 30,
  created_at: '2024-01-01T00:00:00Z',
  completed_at: '2024-01-01T00:01:00Z',
  expires_at: '2024-01-31T00:00:00Z',
};

describe('IndexSnapshotService', () => {
  let sql: ReturnType<typeof vi.fn>;
  let service: IndexSnapshotService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listSnapshots', () => {
    it('returns list of snapshots', async () => {
      sql = vi.fn(async () => [SNAPSHOT_ROW]);
      service = new IndexSnapshotService(sql as unknown as ConstructorParameters<typeof IndexSnapshotService>[0]);
      const result = await service.listSnapshots('ws-1');
      expect(result.isOk()).toBe(true);
      const snapshots = result._unsafeUnwrap();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.id).toBe('snap-uuid-1');
    });

    it('returns empty list when no snapshots', async () => {
      sql = vi.fn(async () => []);
      service = new IndexSnapshotService(sql as unknown as ConstructorParameters<typeof IndexSnapshotService>[0]);
      const result = await service.listSnapshots('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('query failed'));
      service = new IndexSnapshotService(sql as unknown as ConstructorParameters<typeof IndexSnapshotService>[0]);
      const result = await service.listSnapshots('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('createSnapshot', () => {
    it('inserts a pending record and returns ready snapshot', async () => {
      let callCount = 0;
      sql = vi.fn(async () => {
        callCount++;
        if (callCount === 1) return [{ id: 'snap-uuid-1' }]; // INSERT
        if (callCount === 2) return [{ id: 'e1', type: 'contact' }]; // entities
        if (callCount === 3) return []; // glossary
        if (callCount === 4) return []; // UPDATE
        if (callCount === 5) return []; // prune
        return [SNAPSHOT_ROW]; // SELECT
      });
      service = new IndexSnapshotService(sql as unknown as ConstructorParameters<typeof IndexSnapshotService>[0]);
      const result = await service.createSnapshot('ws-1');
      expect(result.isOk()).toBe(true);
    });

    it('marks snapshot as failed when entity query throws', async () => {
      let callCount = 0;
      sql = vi.fn(async () => {
        callCount++;
        if (callCount === 1) return [{ id: 'snap-uuid-1' }]; // INSERT
        throw new Error('entity query failed');
      });
      service = new IndexSnapshotService(sql as unknown as ConstructorParameters<typeof IndexSnapshotService>[0]);
      const result = await service.createSnapshot('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('restoreFromSnapshot', () => {
    it('returns err when snapshot not found', async () => {
      sql = vi.fn(async () => []);
      service = new IndexSnapshotService(sql as unknown as ConstructorParameters<typeof IndexSnapshotService>[0]);
      const result = await service.restoreFromSnapshot('ws-1', 'missing-id');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');
    });

    it('returns err when snapshot is not in ready state', async () => {
      sql = vi.fn(async () => [{ storage_path: '/tmp/snap.gz', status: 'creating' }]);
      service = new IndexSnapshotService(sql as unknown as ConstructorParameters<typeof IndexSnapshotService>[0]);
      const result = await service.restoreFromSnapshot('ws-1', 'snap-1');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not in ready state');
    });
  });

  describe('SnapshotRecord shape', () => {
    it('maps all fields from database row', async () => {
      sql = vi.fn(async () => [SNAPSHOT_ROW]);
      service = new IndexSnapshotService(sql as unknown as ConstructorParameters<typeof IndexSnapshotService>[0]);
      const result = await service.listSnapshots('ws-1');
      const snap = result._unsafeUnwrap()[0]!;
      expect(snap.entityCount).toBe(50);
      expect(snap.snapshotSizeBytes).toBe(2048);
      expect(snap.retentionDays).toBe(30);
      expect(snap.completedAt).toBeInstanceOf(Date);
      expect(snap.expiresAt).toBeInstanceOf(Date);
    });
  });
});
