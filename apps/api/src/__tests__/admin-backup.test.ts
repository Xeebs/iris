import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core', () => ({
  DataExporter: vi.fn().mockImplementation(() => ({
    importWorkspace: vi.fn(),
  })),
}));

import { ok, err } from 'neverthrow';
import { DataExporter } from '@iris/semantic-core';
import { createAdminBackupRoutes } from '../routes/admin-backup.js';

const mockSql = Object.assign(vi.fn(() => Promise.resolve([])), {
  json: (v: unknown) => v,
}) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-admin');
    await next();
  });
  app.route('/', createAdminBackupRoutes(mockSql));
  return app;
}

const sampleBackup = {
  version: '1.0',
  exportedAt: '2026-01-01T00:00:00Z',
  workspaceId: 'ws-source',
  exportType: 'full',
  entities: [],
  glossaryTerms: [],
  metrics: [],
  relationships: [],
  schemaDefinitions: [],
  entityCount: 0,
};

describe('admin-backup routes', () => {
  let mockExporter: { importWorkspace: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockExporter = { importWorkspace: vi.fn() };
    (DataExporter as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockExporter);
  });

  describe('POST /import', () => {
    it('returns 200 with import counts on success', async () => {
      mockExporter.importWorkspace = vi.fn().mockResolvedValue(
        ok({ importedEntities: 5, importedTerms: 2, importedMetrics: 1 }),
      );
      const app = makeApp();

      const res = await app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWorkspaceId: 'ws-target', backup: sampleBackup }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Record<string, number> };
      expect(body.data.importedEntities).toBe(5);
      expect(body.data.importedTerms).toBe(2);
    });

    it('returns 400 when body is missing targetWorkspaceId', async () => {
      const app = makeApp();

      const res = await app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup: sampleBackup }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when backup version is wrong', async () => {
      const app = makeApp();

      const res = await app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWorkspaceId: 'ws-target',
          backup: { ...sampleBackup, version: '2.0' },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when body is not JSON', async () => {
      const app = makeApp();

      const res = await app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 when import fails', async () => {
      mockExporter.importWorkspace = vi.fn().mockResolvedValue(err(new Error('DB error')));
      const app = makeApp();

      const res = await app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWorkspaceId: 'ws-target', backup: sampleBackup }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /jobs', () => {
    it('returns paginated list of all export jobs', async () => {
      (mockSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'j1', workspace_id: 'ws-a', status: 'completed', export_type: 'full',
          progress_pct: 100, entity_count: 15, error_message: null,
          created_at: new Date(), started_at: new Date(), completed_at: new Date() },
      ]);
      const app = makeApp();

      const res = await app.request('/jobs');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { hasMore: boolean } };
      expect(body.data).toHaveLength(1);
    });

    it('filters by workspace when workspaceId query param provided', async () => {
      (mockSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/jobs?workspaceId=ws-specific');

      expect(res.status).toBe(200);
    });

    it('filters by status when provided', async () => {
      (mockSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/jobs?status=failed');

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid status value', async () => {
      const app = makeApp();

      const res = await app.request('/jobs?status=unknown');

      expect(res.status).toBe(400);
    });
  });
});
