import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock @hono/zod-validator since it's not installed
vi.mock('@hono/zod-validator', () => ({
  zValidator: (type: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) =>
    async (c: { req: { json: () => Promise<unknown>; query: (k: string) => string | undefined }; json: (b: unknown, s?: number) => unknown; set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      const source = type === 'json'
        ? await c.req.json().catch(() => ({}))
        : {} as Record<string, string>;

      if (type === 'query') {
        const url = new URL((c as unknown as { req: { url: string } }).req.url);
        const params: Record<string, string> = {};
        url.searchParams.forEach((v, k) => { params[k] = v; });
        const parsed = schema.safeParse(params);
        if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR' } }, 400);
        (c.req as unknown as Record<string, unknown>).valid = () => parsed.data;
      } else {
        const parsed = schema.safeParse(source);
        if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR' } }, 400);
        (c.req as unknown as Record<string, unknown>).valid = () => parsed.data;
      }
      await next();
    },
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createAdminCostAuditRoutes } = await import('../routes/admin-cost-audit.js');
  return createAdminCostAuditRoutes;
}

const SAMPLE_ROW = {
  workspace_id: 'ws-1', total_cents: '5000',
  embeddings_cents: '2000', queries_cents: '2000', storage_cents: '500', cache_miss_cents: '500',
};

describe('admin-cost-audit routes', () => {
  let createAdminCostAuditRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createAdminCostAuditRoutes = await importRoutes();
  });

  function makeSql(returnValue: unknown[] = []) {
    return vi.fn().mockResolvedValue(returnValue) as unknown as Parameters<typeof createAdminCostAuditRoutes>[0];
  }

  function buildApp(sqlMock: ReturnType<typeof makeSql>) {
    const app = new Hono();
    app.route('/admin/cost-audit', createAdminCostAuditRoutes(sqlMock));
    return app;
  }

  describe('POST /', () => {
    it('returns 200 with cost audit data', async () => {
      const sql = makeSql([SAMPLE_ROW]);
      const res = await buildApp(sql).request('/admin/cost-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '2026-01-01', to: '2026-06-30' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ workspaceId: string; totalCents: number }> };
      expect(body.data[0]!.totalCents).toBe(5000);
    });

    it('returns 400 with invalid date format', async () => {
      const res = await buildApp(makeSql()).request('/admin/cost-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'not-a-date', to: '2026-06-30' }),
      });
      expect(res.status).toBe(400);
    });

    it('paginates results when rows exceed limit', async () => {
      const rows = Array.from({ length: 51 }, (_, i) => ({ ...SAMPLE_ROW, workspace_id: `ws-${i}` }));
      const sql = makeSql(rows);
      const res = await buildApp(sql).request('/admin/cost-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '2026-01-01', to: '2026-06-30', limit: 50 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean; nextCursor?: string } };
      expect(body.meta.hasMore).toBe(true);
      expect(body.meta.nextCursor).toBeDefined();
    });

    it('returns 200 with empty data when no results', async () => {
      const res = await buildApp(makeSql([])).request('/admin/cost-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '2026-01-01', to: '2026-06-30' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  describe('GET /top-workspaces', () => {
    it('returns 200 with top workspaces', async () => {
      const sql = makeSql([{ workspace_id: 'ws-1', total_cents: '10000' }]);
      const res = await buildApp(sql).request('/admin/cost-audit/top-workspaces?from=2026-01-01&to=2026-06-30');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ totalCents: number }> };
      expect(body.data[0]!.totalCents).toBe(10000);
    });
  });
});
