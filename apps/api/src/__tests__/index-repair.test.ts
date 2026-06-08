import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createIndexRepairRoutes } from '../routes/index-repair.js';

const mockSql = vi.fn().mockResolvedValue([]);

function makeApp() {
  const routes = createIndexRepairRoutes(mockSql as never);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    c.set('userId', 'user-test');
    await next();
  });
  app.route('/index-repair', routes);
  return app;
}

function makeScanRow() {
  return {
    scan_id: 'scan-uuid',
    workspace_id: 'ws-test',
    status: 'completed',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    issue_count: 0,
  };
}

function makeJobRow() {
  return {
    job_id: 'job-uuid',
    workspace_id: 'ws-test',
    entity_type_filter: null,
    status: 'completed',
    estimated_entities: 100,
    reindexed_count: 100,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };
}

describe('Index Repair Routes', () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  describe('POST /index-repair/scan', () => {
    it('returns 201 with integrity report', async () => {
      mockSql
        .mockResolvedValueOnce([]) // INSERT integrity_scans
        .mockResolvedValueOnce([{ id: 'e:1' }]) // entities
        .mockResolvedValueOnce([{ entity_id: 'e:1' }]) // vectors
        .mockResolvedValueOnce([]) // relationships
        .mockResolvedValueOnce([]); // UPDATE

      const res = await app.request('/index-repair/scan', { method: 'POST' });
      expect(res.status).toBe(201);
      const body = await res.json() as { data: { isHealthy: boolean } };
      expect(typeof body.data.isHealthy).toBe('boolean');
    });

    it('returns 401 without workspaceId', async () => {
      const plain = createIndexRepairRoutes(mockSql as never);
      const bare = new Hono();
      bare.route('/index-repair', plain);
      const res = await bare.request('/index-repair/scan', { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /index-repair/scans', () => {
    it('returns list of scans', async () => {
      mockSql.mockResolvedValueOnce([makeScanRow()]);
      const res = await app.request('/index-repair/scans');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(1);
    });
  });

  describe('GET /index-repair/report', () => {
    it('returns null data when no scan exists', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/index-repair/report');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: null };
      expect(body.data).toBeNull();
    });

    it('returns latest report when scan exists', async () => {
      mockSql.mockResolvedValueOnce([
        { report_json: { workspaceId: 'ws-test', isHealthy: true, issues: [] } },
      ]);
      const res = await app.request('/index-repair/report');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /index-repair/rebuild', () => {
    it('returns 200 in dry-run mode', async () => {
      mockSql.mockResolvedValueOnce([{ total: 42 }]);
      const res = await app.request('/index-repair/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; estimatedEntities: number } };
      expect(body.data.status).toBe('dry_run');
      expect(body.data.estimatedEntities).toBe(42);
    });

    it('returns 201 for real rebuild', async () => {
      mockSql
        .mockResolvedValueOnce([{ total: 5 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'e:1' }])
        .mockResolvedValueOnce([]);

      const res = await app.request('/index-repair/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.request('/index-repair/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: 'yes-please' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /index-repair/rebuild-jobs', () => {
    it('returns list of rebuild jobs', async () => {
      mockSql.mockResolvedValueOnce([makeJobRow()]);
      const res = await app.request('/index-repair/rebuild-jobs');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(1);
    });
  });

  describe('POST /index-repair/rollback/:snapshotId', () => {
    it('returns 404 for unknown snapshot', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/index-repair/rollback/snap-missing', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 200 for valid snapshot', async () => {
      mockSql
        .mockResolvedValueOnce([{ entity_count: 50 }])
        .mockResolvedValueOnce([]);

      const res = await app.request('/index-repair/rollback/snap-valid', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { rolledBack: boolean } };
      expect(body.data.rolledBack).toBe(true);
    });
  });
});
