import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDocumentsRoutes } from '../routes/documents.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const mockSearchResults = [
  { documentId: 'doc-1', sourceEntityId: 'notion:page:1', documentTitle: 'Q4 Strategy', excerpt: '…growth targets…', score: 0.85 },
];

const mockStats = [
  { sourceConnectorId: 'notion-prod', documentCount: 42, totalTokens: 21000, lastExtractedAt: '2026-01-15T10:00:00Z' },
];

vi.mock('@iris/semantic-core/document-indexer', () => ({
  DocumentIndexer: vi.fn().mockImplementation(() => ({
    searchDocuments: vi.fn().mockResolvedValue(mockSearchResults),
    getIndexingStats: vi.fn().mockResolvedValue(mockStats),
    indexDocument: vi.fn().mockResolvedValue(true),
    deleteByConnector: vi.fn().mockResolvedValue(5),
  })),
}));

function makeApp() {
  const sql = vi.fn().mockResolvedValue([]);
  const app = new Hono();
  app.route('/api/v1/documents', createDocumentsRoutes(sql as never));
  return { app, sql };
}

const validBulkBody = {
  documents: [
    {
      sourceConnectorId: 'notion-prod',
      sourceEntityId: 'notion:page:1',
      documentTitle: 'Q4 Strategy',
      contentPlaintext: 'Detailed Q4 growth targets and KPIs...',
    },
  ],
};

describe('GET /api/v1/documents/search', () => {
  it('returns 200 with search results', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/documents/search?q=strategy', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof mockSearchResults; meta: { query: string; totalResults: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.query).toBe('strategy');
  });

  it('returns 400 for missing q parameter', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/documents/search', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(400);
  });

  it('clamps limit to max 100', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/documents/search?q=test&limit=200', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on search error', async () => {
    const { DocumentIndexer } = await import('@iris/semantic-core/document-indexer');
    vi.mocked(DocumentIndexer).mockImplementationOnce(() => ({
      searchDocuments: vi.fn().mockRejectedValue(new Error('db down')),
      getIndexingStats: vi.fn(),
      indexDocument: vi.fn(),
      deleteByConnector: vi.fn(),
    }));
    const sql = vi.fn().mockResolvedValue([]);
    const app = new Hono();
    app.route('/api/v1/documents', createDocumentsRoutes(sql as never));
    const res = await app.request('/api/v1/documents/search?q=test', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SEARCH_FAILED');
  });
});

describe('GET /api/v1/documents/stats', () => {
  it('returns indexing stats', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/documents/stats', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof mockStats };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.documentCount).toBe(42);
  });

  it('returns 500 on stats error', async () => {
    const { DocumentIndexer } = await import('@iris/semantic-core/document-indexer');
    vi.mocked(DocumentIndexer).mockImplementationOnce(() => ({
      searchDocuments: vi.fn(),
      getIndexingStats: vi.fn().mockRejectedValue(new Error('db error')),
      indexDocument: vi.fn(),
      deleteByConnector: vi.fn(),
    }));
    const sql = vi.fn().mockResolvedValue([]);
    const app = new Hono();
    app.route('/api/v1/documents', createDocumentsRoutes(sql as never));
    const res = await app.request('/api/v1/documents/stats', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/documents/import/bulk', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it('returns 201 with indexed/skipped counts', async () => {
    const res = await app.request('/api/v1/documents/import/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify(validBulkBody),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { indexed: number; skipped: number; total: number } };
    expect(body.data.indexed).toBe(1);
    expect(body.data.total).toBe(1);
  });

  it('returns 400 for empty documents array', async () => {
    const res = await app.request('/api/v1/documents/import/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ documents: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing documents field', async () => {
    const res = await app.request('/api/v1/documents/import/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('counts skipped when indexDocument returns false', async () => {
    const { DocumentIndexer } = await import('@iris/semantic-core/document-indexer');
    vi.mocked(DocumentIndexer).mockImplementationOnce(() => ({
      searchDocuments: vi.fn(),
      getIndexingStats: vi.fn(),
      indexDocument: vi.fn().mockResolvedValue(false),
      deleteByConnector: vi.fn(),
    }));
    const sql = vi.fn().mockResolvedValue([]);
    const app2 = new Hono();
    app2.route('/api/v1/documents', createDocumentsRoutes(sql as never));
    const res = await app2.request('/api/v1/documents/import/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify(validBulkBody),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { indexed: number; skipped: number } };
    expect(body.data.skipped).toBe(1);
    expect(body.data.indexed).toBe(0);
  });
});

describe('DELETE /api/v1/documents/connector/:connectorId', () => {
  it('returns deleted count', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/documents/connector/notion-prod', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: number } };
    expect(body.data.deleted).toBe(5);
  });

  it('returns 500 on deletion error', async () => {
    const { DocumentIndexer } = await import('@iris/semantic-core/document-indexer');
    vi.mocked(DocumentIndexer).mockImplementationOnce(() => ({
      searchDocuments: vi.fn(),
      getIndexingStats: vi.fn(),
      indexDocument: vi.fn(),
      deleteByConnector: vi.fn().mockRejectedValue(new Error('db error')),
    }));
    const sql = vi.fn().mockResolvedValue([]);
    const app2 = new Hono();
    app2.route('/api/v1/documents', createDocumentsRoutes(sql as never));
    const res = await app2.request('/api/v1/documents/connector/bad-conn', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(500);
  });
});
