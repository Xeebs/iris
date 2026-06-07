import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAdminConsoleRoutes } from '../routes/admin-console.js';

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn(() => ({ userId: 'admin-user', orgRole: 'admin' })),
  clerkMiddleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const mockSqlFn = vi.fn((..._args: unknown[]) => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp(workspaceId = 'ws-admin') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', workspaceId);
    await next();
  });
  app.route('/', createAdminConsoleRoutes(mockSqlFn));
  return app;
}

describe('admin-console routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlFn.mockResolvedValue([]);
  });

  describe('GET /workspaces', () => {
    it('returns list of workspaces with counts', async () => {
      const mockWorkspaces = [
        {
          id: 'ws-1',
          name: 'Acme Corp',
          created_at: new Date().toISOString(),
          connector_count: 3,
          mcp_query_volume: 150,
          last_mcp_query_at: new Date().toISOString(),
          last_sync_at: new Date().toISOString(),
        },
      ];
      mockSqlFn.mockResolvedValueOnce(mockWorkspaces);
      const app = makeApp();

      const res = await app.request('/workspaces');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { hasMore: boolean } };
      expect(body.data).toHaveLength(1);
      expect(body.meta.hasMore).toBe(false);
    });

    it('supports cursor pagination', async () => {
      const mockWorkspaces = Array.from({ length: 51 }, (_, i) => ({
        id: `ws-${i + 1}`,
        name: `Workspace ${i + 1}`,
        created_at: new Date().toISOString(),
        connector_count: 0,
        mcp_query_volume: 0,
        last_mcp_query_at: null,
        last_sync_at: null,
      }));
      mockSqlFn.mockResolvedValueOnce(mockWorkspaces);
      const app = makeApp();

      const res = await app.request('/workspaces?limit=50');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { hasMore: boolean; nextCursor: string } };
      expect(body.data).toHaveLength(50);
      expect(body.meta.hasMore).toBe(true);
      expect(body.meta.nextCursor).toBeTruthy();
    });

    it('returns 500 on database error', async () => {
      mockSqlFn.mockRejectedValueOnce(new Error('connection refused'));
      const app = makeApp();

      const res = await app.request('/workspaces');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /system-health', () => {
    it('returns 200 with ok status when all checks pass', async () => {
      mockSqlFn
        .mockResolvedValueOnce([{ '?column?': 1 }]) // SELECT 1
        .mockResolvedValueOnce([{ workspace_count: 5, connector_count: 12 }]);
      const app = makeApp();

      const res = await app.request('/system-health');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string; checks: unknown } };
      expect(body.data.status).toBe('ok');
      expect(body.data.checks).toHaveProperty('postgres');
    });

    it('returns 503 when postgres fails', async () => {
      mockSqlFn.mockRejectedValueOnce(new Error('cannot connect'));
      const app = makeApp();

      const res = await app.request('/system-health');

      expect(res.status).toBe(503);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('degraded');
    });
  });

  describe('GET /errors', () => {
    it('returns failed sync records', async () => {
      const mockErrors = [
        {
          id: 'err-1',
          connector_instance_id: 'inst-1',
          workspace_id: 'ws-1',
          job_id: 'job-1',
          status: 'failed',
          error_count: 3,
          total_duration_ms: 1500,
          started_at: new Date().toISOString(),
        },
      ];
      mockSqlFn.mockResolvedValueOnce(mockErrors).mockResolvedValueOnce([{ workspace_id: 'ws-1', error_count: 3 }]);
      const app = makeApp();

      const res = await app.request('/errors?days=7');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { errors: unknown[]; periodDays: number } };
      expect(body.data.errors).toHaveLength(1);
      expect(body.data.periodDays).toBe(7);
    });

    it('returns empty array when no errors', async () => {
      mockSqlFn.mockResolvedValue([]);
      const app = makeApp();

      const res = await app.request('/errors');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { errors: unknown[] } };
      expect(body.data.errors).toHaveLength(0);
    });
  });
});
