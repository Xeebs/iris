import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  },
}));

const mockIndexer = {
  getIndexingStats: vi.fn(),
  searchDocuments: vi.fn(),
  deleteByConnector: vi.fn(),
};

vi.mock('@iris/semantic-core/document-indexer', () => ({
  DocumentIndexer: vi.fn(() => mockIndexer),
}));

import { createDocumentIndexingRoutes } from '../routes/document-indexing.js';

const mockSql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;

function makeApp(withWorkspace = true) {
  const app = new Hono();
  if (withWorkspace) {
    app.use('*', async (c, next) => {
      c.set('workspaceId', 'ws-test');
      await next();
    });
  }
  app.route('/', createDocumentIndexingRoutes(mockSql));
  return app;
}

const statsFixture = [
  {
    sourceConnectorId: 'gdrive-1',
    documentCount: 42,
    totalTokens: 18000,
    lastExtractedAt: '2026-06-08T00:00:00Z',
  },
  {
    sourceConnectorId: 'confluence-1',
    documentCount: 120,
    totalTokens: 85000,
    lastExtractedAt: '2026-06-07T12:00:00Z',
  },
];

const searchResultsFixture = [
  {
    documentId: 'doc-1',
    title: 'Q3 Sales Report',
    excerpt: 'Revenue increased by 15% in Q3…',
    score: 0.91,
    connectorId: 'gdrive-1',
  },
  {
    documentId: 'doc-2',
    title: 'Product Roadmap',
    excerpt: 'New features planned for H2…',
    score: 0.87,
    connectorId: 'confluence-1',
  },
];

describe('document-indexing routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /stats', () => {
    it('returns per-connector stats with 200', async () => {
      mockIndexer.getIndexingStats.mockResolvedValueOnce(statsFixture);
      const res = await makeApp().request('/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof statsFixture };
      expect(body.data).toHaveLength(2);
    });

    it('returns 401 when workspaceId context is missing', async () => {
      const res = await makeApp(false).request('/stats');
      expect(res.status).toBe(401);
    });

    it('returns empty array when no documents are indexed', async () => {
      mockIndexer.getIndexingStats.mockResolvedValueOnce([]);
      const res = await makeApp().request('/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('returns 500 when indexer throws', async () => {
      mockIndexer.getIndexingStats.mockRejectedValueOnce(new Error('DB error'));
      const res = await makeApp().request('/stats');
      expect(res.status).toBe(500);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns document count and token stats per connector', async () => {
      mockIndexer.getIndexingStats.mockResolvedValueOnce(statsFixture);
      const res = await makeApp().request('/stats');
      const body = await res.json() as { data: Array<{ totalTokens: number }> };
      expect(body.data[0]!.totalTokens).toBeGreaterThan(0);
    });

    it('includes lastExtractedAt field for each connector', async () => {
      mockIndexer.getIndexingStats.mockResolvedValueOnce(statsFixture);
      const res = await makeApp().request('/stats');
      const body = await res.json() as { data: Array<{ lastExtractedAt: string }> };
      expect(body.data.every((s) => typeof s.lastExtractedAt === 'string')).toBe(true);
    });
  });

  describe('GET /search', () => {
    it('returns search results for a valid query', async () => {
      mockIndexer.searchDocuments.mockResolvedValueOnce(searchResultsFixture);
      const res = await makeApp().request('/search?q=sales+report');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof searchResultsFixture };
      expect(body.data).toHaveLength(2);
    });

    it('returns 400 when q param is missing', async () => {
      const res = await makeApp().request('/search');
      expect(res.status).toBe(400);
    });

    it('returns 400 when q param is empty string', async () => {
      const res = await makeApp().request('/search?q=');
      expect(res.status).toBe(400);
    });

    it('returns 400 when q exceeds 500 characters', async () => {
      const longQuery = 'a'.repeat(501);
      const res = await makeApp().request(`/search?q=${longQuery}`);
      expect(res.status).toBe(400);
    });

    it('uses default limit of 10 when not specified', async () => {
      mockIndexer.searchDocuments.mockResolvedValueOnce([]);
      await makeApp().request('/search?q=test');
      expect(mockIndexer.searchDocuments).toHaveBeenCalledWith('ws-test', 'test', 10);
    });

    it('accepts custom limit param up to 50', async () => {
      mockIndexer.searchDocuments.mockResolvedValueOnce([]);
      await makeApp().request('/search?q=test&limit=25');
      expect(mockIndexer.searchDocuments).toHaveBeenCalledWith('ws-test', 'test', 25);
    });

    it('returns 401 when workspace context is missing', async () => {
      const res = await makeApp(false).request('/search?q=test');
      expect(res.status).toBe(401);
    });

    it('returns 500 when search throws', async () => {
      mockIndexer.searchDocuments.mockRejectedValueOnce(new Error('Search failed'));
      const res = await makeApp().request('/search?q=sales');
      expect(res.status).toBe(500);
    });

    it('returns empty results gracefully', async () => {
      mockIndexer.searchDocuments.mockResolvedValueOnce([]);
      const res = await makeApp().request('/search?q=nonexistent');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('includes score field in results', async () => {
      mockIndexer.searchDocuments.mockResolvedValueOnce(searchResultsFixture);
      const res = await makeApp().request('/search?q=sales');
      const body = await res.json() as { data: Array<{ score: number }> };
      expect(body.data[0]!.score).toBeGreaterThan(0);
    });
  });

  describe('DELETE /connector/:id', () => {
    it('deletes documents for a connector and returns count', async () => {
      mockIndexer.deleteByConnector.mockResolvedValueOnce(42);
      const res = await makeApp().request('/connector/gdrive-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { deleted: number } };
      expect(body.data.deleted).toBe(42);
    });

    it('returns 0 when no documents existed for connector', async () => {
      mockIndexer.deleteByConnector.mockResolvedValueOnce(0);
      const res = await makeApp().request('/connector/empty-conn', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { deleted: number } };
      expect(body.data.deleted).toBe(0);
    });

    it('returns 401 when workspace context is missing', async () => {
      const res = await makeApp(false).request('/connector/gdrive-1', { method: 'DELETE' });
      expect(res.status).toBe(401);
    });

    it('returns 500 when delete throws', async () => {
      mockIndexer.deleteByConnector.mockRejectedValueOnce(new Error('DB error'));
      const res = await makeApp().request('/connector/gdrive-1', { method: 'DELETE' });
      expect(res.status).toBe(500);
    });

    it('calls deleteByConnector with correct workspace and connectorId', async () => {
      mockIndexer.deleteByConnector.mockResolvedValueOnce(5);
      await makeApp().request('/connector/my-connector', { method: 'DELETE' });
      expect(mockIndexer.deleteByConnector).toHaveBeenCalledWith('ws-test', 'my-connector');
    });
  });
});
