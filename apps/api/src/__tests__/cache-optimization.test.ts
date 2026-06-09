import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createCacheOptimizationRoutes } from '../routes/cache-optimization.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp(sqlRows: unknown[] = []) {
  const app = new Hono();
  app.route('/cache', createCacheOptimizationRoutes(makeSql(sqlRows)));
  return app;
}

// ─── GET /cache/stats ─────────────────────────────────────────────────────────

describe('GET /cache/stats', () => {
  it('returns 200 with empty stats', async () => {
    const app = buildApp([]);
    const res = await app.request('/cache/stats?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { totalEntries: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.totalEntries).toBe(0);
  });

  it('returns 200 with populated stats', async () => {
    const row = {
      stat_id: 's-1', workspace_id: 'ws-1', query_hash: 'abc123',
      query_text: 'show top deals', entity_type: 'deal',
      total_requests: 100, cache_hits: 75, total_saved_tokens: 5000,
      last_hit_at: new Date(), created_at: new Date(), updated_at: new Date(),
    };
    const app = buildApp([row]);
    const res = await app.request('/cache/stats?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ hitRate: number }> };
    expect(body.data[0]!.hitRate).toBeCloseTo(0.75);
  });

  it('accepts entityType filter', async () => {
    const app = buildApp([]);
    const res = await app.request('/cache/stats?workspaceId=ws-1&entityType=deal');
    expect(res.status).toBe(200);
  });

  it('includes overall hit rate in meta', async () => {
    const app = buildApp([]);
    const res = await app.request('/cache/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as { meta: { overallHitRate: number } };
    expect(typeof body.meta.overallHitRate).toBe('number');
  });
});

// ─── GET /cache/dependencies/:queryId ─────────────────────────────────────────

describe('GET /cache/dependencies/:queryId', () => {
  it('returns 200 with empty dependencies', async () => {
    const app = buildApp([]);
    const res = await app.request('/cache/dependencies/abc123?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { queryHash: string; dependencies: unknown[] } };
    expect(body.data.queryHash).toBe('abc123');
    expect(Array.isArray(body.data.dependencies)).toBe(true);
  });

  it('returns dependency entityIds', async () => {
    const row = { dep_id: 'd-1', query_hash: 'q1', entity_id: 'entity-abc', created_at: new Date() };
    const app = buildApp([row]);
    const res = await app.request('/cache/dependencies/q1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { dependencies: Array<{ entityId: string }> } };
    expect(body.data.dependencies[0]!.entityId).toBe('entity-abc');
  });
});

// ─── POST /cache/prefetch ─────────────────────────────────────────────────────

describe('POST /cache/prefetch', () => {
  it('returns 200 with recommendations', async () => {
    const patterns = [
      { query_hash: 'q1', query_text: 'top deals', observed_at: new Date() },
      { query_hash: 'q1', query_text: 'top deals', observed_at: new Date() },
      { query_hash: 'q2', query_text: 'pipeline report', observed_at: new Date() },
    ];
    const app = buildApp(patterns);
    const res = await app.request('/cache/prefetch', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', userId: 'user-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recommendations: unknown[] } };
    expect(Array.isArray(body.data.recommendations)).toBe(true);
  });

  it('returns 400 for missing userId', async () => {
    const app = buildApp([]);
    const res = await app.request('/cache/prefetch', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing workspaceId', async () => {
    const app = buildApp([]);
    const res = await app.request('/cache/prefetch', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /cache/entries/:queryId ───────────────────────────────────────────

describe('DELETE /cache/entries/:queryId', () => {
  it('returns 200 with invalidated=true', async () => {
    const app = buildApp([]);
    const res = await app.request('/cache/entries/q-abc', {
      method: 'DELETE',
      body: JSON.stringify({ workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { invalidated: boolean } };
    expect(body.data.invalidated).toBe(true);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = buildApp([]);
    const res = await app.request('/cache/entries/q-abc', {
      method: 'DELETE',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
