import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createAuditRoutes } = await import('../routes/audit.js');
  return createAuditRoutes;
}

function makeSql(returnValue: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnValue) as unknown as Parameters<Awaited<ReturnType<typeof importRoutes>>>[0];
}

describe('audit routes', () => {
  let createAuditRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createAuditRoutes = await importRoutes();
  });

  function buildApp(sqlMock: ReturnType<typeof makeSql>) {
    const app = new Hono();
    app.route('/audit', createAuditRoutes(sqlMock));
    return app;
  }

  it('returns 200 with audit records when valid params', async () => {
    const rows = [
      { id: '1', workspace_id: 'ws-1', tool_name: 'query-context', query: 'test', token_estimate: 100, cache_hit: false, duration_ms: 50, timestamp: new Date() },
    ];
    const sql = makeSql(rows);
    const app = buildApp(sql);
    const res = await app.request('/audit?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.hasMore).toBe(false);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = buildApp(makeSql());
    const res = await app.request('/audit');
    expect(res.status).toBe(400);
  });

  it('paginates correctly when row count exceeds limit', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: String(i), workspace_id: 'ws-1', tool_name: 'query-context', query: 'q', token_estimate: 10, cache_hit: false, duration_ms: 20, timestamp: new Date(),
    }));
    const sql = makeSql(rows);
    const app = buildApp(sql);
    const res = await app.request('/audit?workspaceId=ws-1&limit=50');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean; nextCursor: string } };
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBeTruthy();
    expect(body.data).toHaveLength(50);
  });

  it('passes cursor to SQL when provided', async () => {
    const sql = makeSql([]);
    const app = buildApp(sql);
    const res = await app.request('/audit?workspaceId=ws-1&cursor=2026-01-01T00:00:00.000Z:abc');
    expect(res.status).toBe(200);
    expect(sql).toHaveBeenCalled();
  });

  it('filters by toolName when provided', async () => {
    const sql = makeSql([]);
    const app = buildApp(sql);
    const res = await app.request('/audit?workspaceId=ws-1&toolName=query-context');
    expect(res.status).toBe(200);
    expect(sql).toHaveBeenCalled();
  });
});
