import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockCache = {
  getStats: vi.fn(),
  resetStats: vi.fn(),
  invalidateWorkspace: vi.fn(),
};

vi.mock('@iris/cache/response-cache', () => ({
  ResponseCache: vi.fn(() => mockCache),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
  default: vi.fn(() => ({})),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createCacheStatsRoutes } = await import('../routes/cache-stats.js');
  return createCacheStatsRoutes;
}

describe('cache-stats routes', () => {
  let createCacheStatsRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createCacheStatsRoutes = await importRoutes();
  });

  function buildApp(workspaceId: string | null = 'ws-1') {
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (workspaceId) c.set('workspaceId', workspaceId);
      await next();
    });
    app.route('/cache', createCacheStatsRoutes({} as never));
    return app;
  }

  describe('GET /stats', () => {
    it('returns 200 with stats', async () => {
      mockCache.getStats.mockResolvedValue({ hits: 50, misses: 10, hitRate: 0.83 });
      const res = await buildApp().request('/cache/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, unknown> };
      expect(body.data).toHaveProperty('hitRate');
    });

    it('returns 500 on error', async () => {
      mockCache.getStats.mockRejectedValue(new Error('redis down'));
      const res = await buildApp().request('/cache/stats');
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /stats', () => {
    it('resets stats and returns 200', async () => {
      mockCache.resetStats.mockResolvedValue(undefined);
      const res = await buildApp().request('/cache/stats', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { reset: boolean } };
      expect(body.data.reset).toBe(true);
    });

    it('returns 500 on error', async () => {
      mockCache.resetStats.mockRejectedValue(new Error('fail'));
      const res = await buildApp().request('/cache/stats', { method: 'DELETE' });
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /workspace/:workspaceId', () => {
    it('invalidates workspace cache', async () => {
      mockCache.invalidateWorkspace.mockResolvedValue(5);
      const res = await buildApp().request('/cache/workspace/ws-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { deleted: number } };
      expect(body.data.deleted).toBe(5);
    });

    it('returns 403 when trying to invalidate another workspace', async () => {
      const res = await buildApp('ws-other').request('/cache/workspace/ws-1', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockCache.invalidateWorkspace.mockRejectedValue(new Error('fail'));
      const res = await buildApp().request('/cache/workspace/ws-1', { method: 'DELETE' });
      expect(res.status).toBe(500);
    });
  });
});
