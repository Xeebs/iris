import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVectorStore = {
  listByType: vi.fn(),
  getById: vi.fn(),
};

vi.mock('@iris/semantic-core', () => ({
  VectorStore: vi.fn(() => mockVectorStore),
  retrieveContext: vi.fn(),
}));

vi.mock('@iris/compression', () => ({
  compress: vi.fn((entities: unknown[]) => ({ content: '', entityCount: entities.length, tokenCount: 100, truncated: false })),
  serializeEntity: vi.fn((e: unknown) => JSON.stringify(e)),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createEntityRoutes } = await import('../routes/entities.js');
  return createEntityRoutes;
}

const SAMPLE_ENTITY = { id: 'hubspot:contact:1', type: 'contact', label: 'Alice', attributes: {}, relationships: [], lastModified: new Date().toISOString(), sourceId: 'hubspot:contact:1' };

describe('entity routes', () => {
  let createEntityRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createEntityRoutes = await importRoutes();
  });

  function buildApp() {
    const app = new Hono();
    app.route('/entities', createEntityRoutes(mockVectorStore as never));
    return app;
  }

  describe('GET /', () => {
    it('returns 200 with entities list', async () => {
      mockVectorStore.listByType.mockResolvedValue([SAMPLE_ENTITY]);
      const res = await buildApp().request('/entities?entityType=contact&workspaceId=ws-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 400 when entityType missing', async () => {
      const res = await buildApp().request('/entities?workspaceId=ws-1');
      expect(res.status).toBe(400);
    });

    it('returns 400 when workspaceId missing', async () => {
      const res = await buildApp().request('/entities?entityType=contact');
      expect(res.status).toBe(400);
    });

    it('returns empty data array when no entities', async () => {
      mockVectorStore.listByType.mockResolvedValue([]);
      const res = await buildApp().request('/entities?entityType=contact&workspaceId=ws-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  describe('GET /:id', () => {
    it('returns 200 with entity by id', async () => {
      mockVectorStore.getById.mockResolvedValue(SAMPLE_ENTITY);
      const res = await buildApp().request('/entities/hubspot:contact:1?workspaceId=ws-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { entity: unknown } };
      expect(body.data.entity).toBeDefined();
    });

    it('returns 404 when entity not found', async () => {
      mockVectorStore.getById.mockResolvedValue(null);
      const res = await buildApp().request('/entities/nonexistent?workspaceId=ws-1');
      expect(res.status).toBe(404);
    });

    it('returns 400 when workspaceId missing', async () => {
      const res = await buildApp().request('/entities/hubspot:contact:1');
      expect(res.status).toBe(400);
    });
  });
});
