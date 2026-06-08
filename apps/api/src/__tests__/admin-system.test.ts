import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAdminSystemRoutes } from '../routes/admin-system.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const mockSql = vi.fn();

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-admin');
    await next();
  });
  app.route('/', createAdminSystemRoutes(mockSql as unknown as ReturnType<typeof import('postgres').default>));
  return app;
}

describe('admin-system routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /performance/summary', () => {
    it('returns aggregated performance metrics', async () => {
      const latency = [{ avg_latency_ms: 120, p50_ms: 100, p95_ms: 400, p99_ms: 800, total_requests: 5000 }];
      const cache = [{ cache_hits: 3200, total_queries: 5000, cache_hit_rate_pct: 64 }];
      const sync = [{ avg_sync_ms: 2000, total_syncs: 150, failed_syncs: 3 }];
      mockSql.mockImplementationOnce(() => Promise.resolve(latency))
             .mockImplementationOnce(() => Promise.resolve(cache))
             .mockImplementationOnce(() => Promise.resolve(sync));

      const app = makeApp();
      const res = await app.request('/performance/summary');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { latency: typeof latency[0]; cache: typeof cache[0]; sync: typeof sync[0] } };
      expect(body.data.latency.avg_latency_ms).toBe(120);
      expect(body.data.cache.cache_hit_rate_pct).toBe(64);
      expect(body.data.sync.failed_syncs).toBe(3);
    });

    it('returns 500 on DB error', async () => {
      mockSql.mockRejectedValueOnce(new Error('db down'));
      const app = makeApp();
      const res = await app.request('/performance/summary');
      expect(res.status).toBe(500);
    });

    it('clamps days parameter to 30', async () => {
      mockSql.mockResolvedValue([{}]);
      const app = makeApp();
      await app.request('/performance/summary?days=99');
      expect(mockSql).toHaveBeenCalled();
    });
  });

  describe('GET /logs', () => {
    it('returns paginated audit log entries', async () => {
      const rows = [
        { id: 'log-1', workspace_id: 'ws-1', service: 'query-context', message: 'find contacts', duration_ms: 80, cache_hit: true },
        { id: 'log-2', workspace_id: 'ws-2', service: 'list-entities', message: 'list deals', duration_ms: 100, cache_hit: false },
      ];
      mockSql.mockResolvedValueOnce(rows);
      const app = makeApp();
      const res = await app.request('/logs');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { hasMore: boolean } };
      expect(body.data).toHaveLength(2);
      expect(body.meta.hasMore).toBe(false);
    });

    it('sets hasMore true and returns nextCursor when rows > limit', async () => {
      const rows = Array.from({ length: 6 }, (_, i) => ({ id: `log-${i}` }));
      mockSql.mockResolvedValueOnce(rows);
      const app = makeApp();
      const res = await app.request('/logs?limit=5');
      const body = (await res.json()) as { meta: { hasMore: boolean; nextCursor: string | null } };
      expect(body.meta.hasMore).toBe(true);
      expect(body.meta.nextCursor).toBe('log-4');
    });

    it('returns 500 on DB error', async () => {
      mockSql.mockRejectedValueOnce(new Error('query failed'));
      const app = makeApp();
      const res = await app.request('/logs');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /users', () => {
    it('returns paginated user list', async () => {
      const rows = [
        { user_id: 'user-1', role: 'admin', workspace_id: 'ws-1', workspace_name: 'Acme', last_active_at: new Date() },
        { user_id: 'user-2', role: 'viewer', workspace_id: 'ws-1', workspace_name: 'Acme', last_active_at: null },
      ];
      mockSql.mockResolvedValueOnce(rows);
      const app = makeApp();
      const res = await app.request('/users');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(2);
    });

    it('returns 500 on DB error', async () => {
      mockSql.mockRejectedValueOnce(new Error('db error'));
      const app = makeApp();
      const res = await app.request('/users');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /workspaces/:id/disable', () => {
    it('disables a workspace and returns updated row', async () => {
      const updated = [{ id: 'ws-1', name: 'Acme', status: 'disabled' }];
      mockSql.mockResolvedValueOnce(updated);
      const app = makeApp();
      const res = await app.request('/workspaces/ws-1/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'billing issue' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: typeof updated[0] };
      expect(body.data.status).toBe('disabled');
    });

    it('returns 404 when workspace not found', async () => {
      mockSql.mockResolvedValueOnce([]);
      const app = makeApp();
      const res = await app.request('/workspaces/bad-id/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it('returns 500 on DB error', async () => {
      mockSql.mockRejectedValueOnce(new Error('db down'));
      const app = makeApp();
      const res = await app.request('/workspaces/ws-1/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(500);
    });
  });
});
