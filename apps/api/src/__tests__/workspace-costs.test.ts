import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock @hono/zod-validator since it's not installed
vi.mock('@hono/zod-validator', () => ({
  zValidator: (type: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) =>
    async (c: { req: { url: string }; json: (b: unknown, s?: number) => unknown }, next: () => Promise<void>) => {
      const url = new URL((c.req as unknown as { url: string }).url);
      const params: Record<string, string> = {};
      url.searchParams.forEach((v, k) => { params[k] = v; });
      const parsed = schema.safeParse(params);
      if (!parsed.success) return (c as unknown as { json: (b: unknown, s: number) => unknown }).json({ error: { code: 'VALIDATION_ERROR' } }, 400);
      (c.req as unknown as Record<string, unknown>).valid = () => parsed.data;
      await next();
    },
}));

const mockManager = { computeWorkspaceCosts: vi.fn() };

vi.mock('@iris/semantic-core/multi-tenant-manager', () => ({
  MultiTenantManager: vi.fn(() => mockManager),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createWorkspaceCostRoutes } = await import('../routes/workspace-costs.js');
  return createWorkspaceCostRoutes;
}

describe('workspace-costs routes', () => {
  let createWorkspaceCostRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createWorkspaceCostRoutes = await importRoutes();
  });

  function makeSql(returnValue: unknown[] = []) {
    return vi.fn().mockResolvedValue(returnValue) as unknown as Parameters<typeof createWorkspaceCostRoutes>[0];
  }

  function buildApp(sqlMock: ReturnType<typeof makeSql>) {
    const app = new Hono();
    app.route('/workspaces', createWorkspaceCostRoutes(sqlMock));
    return app;
  }

  describe('GET /:id/costs', () => {
    it('returns 200 with cost summary', async () => {
      mockManager.computeWorkspaceCosts.mockResolvedValue({ totalCents: 1200, byCategory: {} });
      const res = await buildApp(makeSql()).request('/workspaces/ws-1/costs?from=2026-01-01&to=2026-06-30');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { totalCents: number } };
      expect(body.data.totalCents).toBe(1200);
    });

    it('returns 400 with invalid date format', async () => {
      const res = await buildApp(makeSql()).request('/workspaces/ws-1/costs?from=bad-date&to=2026-06-30');
      expect(res.status).toBe(400);
    });

    it('returns 500 on error', async () => {
      mockManager.computeWorkspaceCosts.mockRejectedValue(new Error('db error'));
      const res = await buildApp(makeSql()).request('/workspaces/ws-1/costs?from=2026-01-01&to=2026-06-30');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /:id/cost-breakdown', () => {
    it('returns 200 with daily cost breakdown', async () => {
      const sql = makeSql([
        { workspace_id: 'ws-1', date: '2026-06-01', cost_category: 'embeddings', amount_cents: '500', metadata_json: {} },
        { workspace_id: 'ws-1', date: '2026-06-01', cost_category: 'queries', amount_cents: '300', metadata_json: {} },
      ]);
      const res = await buildApp(sql).request('/workspaces/ws-1/cost-breakdown?from=2026-01-01&to=2026-06-30');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ date: string }> };
      expect(body.data[0]!.date).toBe('2026-06-01');
    });
  });
});
