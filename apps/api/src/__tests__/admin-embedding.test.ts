import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/embedding-provider', () => ({
  createEmbeddingProvider: vi.fn().mockReturnValue({
    getModelId: () => 'test-model',
    getModelDimensions: () => 1536,
    batchEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2]]),
  }),
}));

vi.mock('@iris/semantic-core/reindex-utils', () => ({
  getEmbeddingMetadata: vi.fn().mockResolvedValue({
    modelId: 'text-embedding-3-small',
    dimension: 1536,
    createdAt: new Date('2026-01-01'),
  }),
  reindexWorkspace: vi.fn().mockResolvedValue({
    entitiesProcessed: 10,
    batchesCompleted: 1,
    tokensEstimated: 500,
    durationMs: 200,
  }),
  recordEmbeddingMetadata: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@iris/semantic-core', () => ({
  PgvectorStore: vi.fn().mockImplementation(() => ({
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createAdminEmbeddingRoutes } from '../routes/admin-embedding.js';
import { getEmbeddingMetadata } from '@iris/semantic-core/reindex-utils';
import { createEmbeddingProvider } from '@iris/semantic-core/embedding-provider';

function makeApp(): Hono {
  const fakeSql = {} as Parameters<typeof createAdminEmbeddingRoutes>[0];
  const app = new Hono();
  app.route('/admin/embedding-config', createAdminEmbeddingRoutes(fakeSql));
  return app;
}

describe('GET /admin/embedding-config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/admin/embedding-config');
    expect(res.status).toBe(400);
  });

  it('returns metadata for a workspace', async () => {
    const app = makeApp();
    const res = await app.request('/admin/embedding-config?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { modelId: string } };
    expect(body.data.modelId).toBe('text-embedding-3-small');
  });

  it('returns data: null when no metadata exists', async () => {
    vi.mocked(getEmbeddingMetadata).mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await app.request('/admin/embedding-config?workspaceId=ws-new');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: null };
    expect(body.data).toBeNull();
  });
});

describe('POST /admin/embedding-config/migrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['DATABASE_URL'] = 'postgresql://localhost/test';
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/admin/embedding-config/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const app = makeApp();
    const res = await app.request('/admin/embedding-config/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid provider', async () => {
    const app = makeApp();
    const res = await app.request('/admin/embedding-config/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', provider: 'unknown' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 422 when provider creation throws', async () => {
    vi.mocked(createEmbeddingProvider).mockImplementationOnce(() => {
      throw new Error('Missing API key');
    });
    const app = makeApp();
    const res = await app.request('/admin/embedding-config/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', provider: 'openai' }),
    });
    expect(res.status).toBe(422);
  });

  it('returns 200 with reindex result on success', async () => {
    const app = makeApp();
    const res = await app.request('/admin/embedding-config/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', provider: 'openai', apiKey: 'key' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entitiesProcessed: number } };
    expect(body.data.entitiesProcessed).toBe(10);
  });

  it('returns 200 with dry-run result', async () => {
    const app = makeApp();
    const res = await app.request('/admin/embedding-config/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', provider: 'openai', apiKey: 'key', dryRun: true }),
    });
    expect(res.status).toBe(200);
  });
});
