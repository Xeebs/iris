import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const _mockService = {
  listSnapshots: vi.fn(),
  createSnapshot: vi.fn(),
  restoreFromSnapshot: vi.fn(),
};

vi.mock('@iris/semantic-core/index-snapshot', () => ({
  IndexSnapshotService: vi.fn(() => _mockService),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createSnapshotRoutes } = await import('../routes/snapshots.js');
  return createSnapshotRoutes;
}

function buildApp(workspaceId: string | null = 'ws-1') {
  const outer = new Hono();
  outer.use('*', async (c, next) => {
    if (workspaceId) c.set('workspaceId', workspaceId);
    await next();
  });
  return outer;
}

function okResult<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value, error: null };
}
function errResult(msg: string) {
  const e = new Error(msg);
  return { isOk: () => false, isErr: () => true, value: undefined, error: e };
}

const SAMPLE_SNAPSHOT = {
  id: 'snap-1',
  workspaceId: 'ws-1',
  status: 'ready',
  entityCount: 150,
  snapshotSizeBytes: 40960,
  storagePath: '/tmp/iris-snapshots/ws-1-snap-1.json.gz',
  retentionDays: 30,
  createdAt: new Date(),
  completedAt: new Date(),
  expiresAt: null,
};

describe('snapshot routes', () => {
  let createSnapshotRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createSnapshotRoutes = await importRoutes();
  });

  describe('GET /', () => {
    it('returns 200 with list of snapshots', async () => {
      _mockService.listSnapshots.mockResolvedValue(okResult([SAMPLE_SNAPSHOT]));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 401 without workspace', async () => {
      const app = buildApp(null);
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots');
      expect(res.status).toBe(401);
    });

    it('returns 500 on service error', async () => {
      _mockService.listSnapshots.mockResolvedValue(errResult('db error'));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots');
      expect(res.status).toBe(500);
    });

    it('returns empty array when no snapshots', async () => {
      _mockService.listSnapshots.mockResolvedValue(okResult([]));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  describe('POST /', () => {
    it('creates a snapshot and returns 201', async () => {
      _mockService.createSnapshot.mockResolvedValue(okResult({ ...SAMPLE_SNAPSHOT, status: 'creating' }));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: 14 }),
      });
      expect(res.status).toBe(201);
    });

    it('creates a snapshot with no body (uses defaults)', async () => {
      _mockService.createSnapshot.mockResolvedValue(okResult(SAMPLE_SNAPSHOT));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots', { method: 'POST' });
      expect(res.status).toBe(201);
      expect(_mockService.createSnapshot).toHaveBeenCalledWith('ws-1', undefined);
    });

    it('returns 401 without workspace', async () => {
      const app = buildApp(null);
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 500 on creation failure', async () => {
      _mockService.createSnapshot.mockResolvedValue(errResult('disk full'));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /:id/restore', () => {
    it('restores from snapshot and returns 200', async () => {
      _mockService.restoreFromSnapshot.mockResolvedValue(okResult({ restored: true, entityCount: 150 }));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots/snap-1/restore', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('returns 404 when snapshot not found', async () => {
      _mockService.restoreFromSnapshot.mockResolvedValue(errResult('Snapshot not found'));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots/nonexistent/restore', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 409 when snapshot not in ready state', async () => {
      _mockService.restoreFromSnapshot.mockResolvedValue(errResult('Snapshot is not in ready state'));
      const app = buildApp();
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots/snap-creating/restore', { method: 'POST' });
      expect(res.status).toBe(409);
    });

    it('returns 401 without workspace', async () => {
      const app = buildApp(null);
      app.route('/snapshots', createSnapshotRoutes({} as never));
      const res = await app.request('/snapshots/snap-1/restore', { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });
});
