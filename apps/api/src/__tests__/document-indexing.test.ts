import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDocumentIndexingRoutes } from '../routes/document-indexing.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/document-indexer', () => {
  const mockIndexer = {
    getIndexingStats: vi.fn(),
    searchDocuments: vi.fn(),
    deleteByConnector: vi.fn(),
  };
  return { DocumentIndexer: vi.fn(() => mockIndexer) };
});

import { DocumentIndexer } from '@iris/semantic-core/document-indexer';

function getIndexerMock() {
  return (DocumentIndexer as unknown as { mock: { results: Array<{ value: typeof mockIndexerMethods }> } }).mock.results[0]!.value;
}

const mockIndexerMethods = {
  getIndexingStats: vi.fn(),
  searchDocuments: vi.fn(),
  deleteByConnector: vi.fn(),
};

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  const mockSql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
  app.route('/', createDocumentIndexingRoutes(mockSql));
  return app;
}

describe('document-indexing routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /stats', () => {
    it('returns per-connector stats', async () => {
      const stats = [
        { sourceConnectorId: 'gdrive-1', documentCount: 42, totalTokens: 18000, lastExtractedAt: '2026-06-08T00:00:00Z' },
      ];

      // Re-create app after clearing mocks
      const app = new Hono();
      app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
      const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
      const { DocumentIndexer: DI } = await import('@iris/semantic-core/document-indexer');
      const inst = new DI(sql);
      (inst.getIndexingStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stats);
      app.route('/', createDocumentIndexingRoutes(sql));

      const res = await app.request('/stats');
      expect(res.status).toBe(200);
    });

    it('returns 401 when workspaceId is missing', async () => {
      const app = new Hono();
      const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
      app.route('/', createDocumentIndexingRoutes(sql));
      const res = await app.request('/stats');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /search', () => {
    it('returns 400 when query param is missing', async () => {
      const app = makeApp();
      const res = await app.request('/search');
      expect(res.status).toBe(400);
    });

    it('returns 400 when query is empty', async () => {
      const app = makeApp();
      const res = await app.request('/search?q=');
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /connector/:id', () => {
    it('returns 401 when workspaceId is missing', async () => {
      const app = new Hono();
      const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
      app.route('/', createDocumentIndexingRoutes(sql));
      const res = await app.request('/connector/gdrive-1', { method: 'DELETE' });
      expect(res.status).toBe(401);
    });
  });
});
