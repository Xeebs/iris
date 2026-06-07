import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createEntityLinkingRoutes } from '../routes/entity-linking.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/entity-linker', () => {
  const mockLinker = {
    listLinks: vi.fn(),
    analyzeEntityConnections: vi.fn(),
    updateLinkStatus: vi.fn(),
  };
  return {
    EntityLinker: vi.fn(() => mockLinker),
    _mockLinker: mockLinker,
  };
});

import { _mockLinker as mockLinker } from '@iris/semantic-core/entity-linker';
import { ok, err } from 'neverthrow';

const mockSqlFn = vi.fn((..._args: unknown[]) => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/', createEntityLinkingRoutes(mockSqlFn));
  return app;
}

const linkFixture = {
  id: 'link-1',
  workspaceId: 'ws-test',
  entityIdA: 'hubspot:contact:1',
  connectorA: 'hubspot',
  entityIdB: 'slack:user:U1',
  connectorB: 'slack',
  confidence: 0.87,
  matchSignals: { compositeScore: 0.87 },
  status: 'proposed' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('entity-linking routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /links', () => {
    it('returns list of cross-connector links', async () => {
      mockLinker.listLinks.mockResolvedValueOnce(ok([linkFixture]));
      const app = makeApp();
      const res = await app.request('/links');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('passes status filter to service', async () => {
      mockLinker.listLinks.mockResolvedValueOnce(ok([]));
      const app = makeApp();
      await app.request('/links?status=confirmed');
      expect(mockLinker.listLinks).toHaveBeenCalledWith('ws-test', 'confirmed', 50);
    });

    it('returns 500 on service error', async () => {
      mockLinker.listLinks.mockResolvedValueOnce(err(new Error('db error')));
      const app = makeApp();
      const res = await app.request('/links');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /analyze', () => {
    it('triggers analysis and returns proposal count', async () => {
      mockLinker.analyzeEntityConnections.mockResolvedValueOnce(ok(5));
      const app = makeApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'contact', threshold: 0.75 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { proposalsCreated: number } };
      expect(body.data.proposalsCreated).toBe(5);
    });

    it('uses defaults when body is empty', async () => {
      mockLinker.analyzeEntityConnections.mockResolvedValueOnce(ok(0));
      const app = makeApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(200);
      expect(mockLinker.analyzeEntityConnections).toHaveBeenCalledWith('ws-test', undefined, 0.70);
    });

    it('returns 400 for invalid threshold', async () => {
      const app = makeApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: 5 }), // > 1
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 on service error', async () => {
      mockLinker.analyzeEntityConnections.mockResolvedValueOnce(err(new Error('table missing')));
      const app = makeApp();
      const res = await app.request('/analyze', { method: 'POST', body: '{}' });
      expect(res.status).toBe(500);
    });
  });

  describe('PUT /links/:id', () => {
    it('confirms a link', async () => {
      mockLinker.updateLinkStatus.mockResolvedValueOnce(ok({ ...linkFixture, status: 'confirmed' }));
      const app = makeApp();
      const res = await app.request('/links/link-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('confirmed');
    });

    it('returns 400 for invalid status', async () => {
      const app = makeApp();
      const res = await app.request('/links/link-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'maybe' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when link not found', async () => {
      mockLinker.updateLinkStatus.mockResolvedValueOnce(err(new Error('Link not found')));
      const app = makeApp();
      const res = await app.request('/links/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      expect(res.status).toBe(404);
    });
  });
});
