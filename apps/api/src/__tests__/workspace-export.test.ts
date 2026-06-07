import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core', () => ({
  DataExporter: vi.fn().mockImplementation(() => ({
    createExportJob: vi.fn(),
    getExportJob: vi.fn(),
    listExportJobs: vi.fn(),
    exportWorkspace: vi.fn(),
  })),
}));

import { ok, err } from 'neverthrow';
import { DataExporter } from '@iris/semantic-core';
import { createWorkspaceExportRoutes } from '../routes/workspace-export.js';

const mockSql = {} as ReturnType<typeof import('postgres').default>;

function makeApp(workspaceId = 'ws-test') {
  const app = new Hono();
  // Simulate auth middleware setting workspaceId
  app.use('*', async (c, next) => {
    c.set('workspaceId', workspaceId);
    await next();
  });
  app.route('/', createWorkspaceExportRoutes(mockSql));
  return app;
}

describe('workspace-export routes', () => {
  let mockExporter: {
    createExportJob: ReturnType<typeof vi.fn>;
    getExportJob: ReturnType<typeof vi.fn>;
    listExportJobs: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const ExporterClass = DataExporter as unknown as ReturnType<typeof vi.fn>;
    mockExporter = ExporterClass.mock.results[0]?.value ?? {
      createExportJob: vi.fn(),
      getExportJob: vi.fn(),
      listExportJobs: vi.fn(),
    };
    // Reset mock instance
    (DataExporter as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockExporter);
  });

  describe('POST /full', () => {
    it('returns 201 with jobId on success', async () => {
      mockExporter.createExportJob = vi.fn().mockResolvedValue(ok('job-abc'));
      const app = makeApp();

      const res = await app.request('/full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeGlossary: true, includeMetrics: true }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { jobId: string } };
      expect(body.data.jobId).toBe('job-abc');
    });

    it('returns 500 when export job creation fails', async () => {
      mockExporter.createExportJob = vi.fn().mockResolvedValue(err(new Error('DB error')));
      const app = makeApp();

      const res = await app.request('/full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /entities', () => {
    it('returns 201 with jobId for entity export', async () => {
      mockExporter.createExportJob = vi.fn().mockResolvedValue(ok('job-def'));
      const app = makeApp();

      const res = await app.request('/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityTypes: ['contact', 'deal'] }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { jobId: string } };
      expect(body.data.jobId).toBe('job-def');
    });

    it('returns 400 for invalid uuid connectorInstanceId', async () => {
      const app = makeApp();

      const res = await app.request('/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorInstanceId: 'not-a-uuid' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /schema', () => {
    it('returns 201 for schema export', async () => {
      mockExporter.createExportJob = vi.fn().mockResolvedValue(ok('job-ghi'));
      const app = makeApp();

      const res = await app.request('/schema', { method: 'POST' });

      expect(res.status).toBe(201);
    });
  });

  describe('GET /jobs', () => {
    it('returns paginated list of jobs', async () => {
      const mockJobs = [
        { id: 'j1', workspaceId: 'ws-test', status: 'completed', exportType: 'full',
          progressPct: 100, entityCount: 10, errorMessage: null, createdAt: new Date(),
          startedAt: new Date(), completedAt: new Date() },
      ];
      mockExporter.listExportJobs = vi.fn().mockResolvedValue(ok({ jobs: mockJobs, hasMore: false }));
      const app = makeApp();

      const res = await app.request('/jobs');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { hasMore: boolean } };
      expect(body.data).toHaveLength(1);
      expect(body.meta.hasMore).toBe(false);
    });

    it('returns 400 for invalid limit', async () => {
      const app = makeApp();
      const res = await app.request('/jobs?limit=999');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /jobs/:jobId', () => {
    it('returns job details without resultData when not completed', async () => {
      const mockJob = {
        id: 'j2', workspaceId: 'ws-test', status: 'running', exportType: 'full',
        progressPct: 50, entityCount: null, errorMessage: null, resultData: null,
        createdAt: new Date(), startedAt: new Date(), completedAt: null, options: null,
      };
      mockExporter.getExportJob = vi.fn().mockResolvedValue(ok(mockJob));
      const app = makeApp();

      const res = await app.request('/jobs/j2');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data.status).toBe('running');
      expect(body.data['resultData']).toBeUndefined();
    });

    it('returns 404 when job not found', async () => {
      mockExporter.getExportJob = vi.fn().mockResolvedValue(err(new Error('Export job not found')));
      const app = makeApp();

      const res = await app.request('/jobs/missing');

      expect(res.status).toBe(404);
    });
  });
});
