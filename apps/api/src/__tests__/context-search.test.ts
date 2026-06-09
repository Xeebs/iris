import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createContextSearchRoutes } from '../routes/context-search.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/context-searcher', () => {
  const isIndexed = vi.fn().mockReturnValue(false);
  const indexMcpResponse = vi.fn();
  const searchWithinContext = vi.fn().mockReturnValue([
    {
      matchId: 'r-1:c1:0',
      entity: { id: 'c1', type: 'contact', label: 'Alice', attributes: { email: 'a@b.com' }, relationships: [] },
      score: 0.85,
      matchingFields: ['label'],
      rank: 1,
    },
  ]);
  return {
    ContextSearcher: vi.fn().mockImplementation(() => ({ isIndexed, indexMcpResponse, searchWithinContext })),
  };
});

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp(sqlRows: unknown[] = []) {
  const app = new Hono();
  app.route('/mcp-responses', createContextSearchRoutes(makeSql(sqlRows)));
  return app;
}

// ─── POST /mcp-responses/:id/search ──────────────────────────────────────────

describe('POST /mcp-responses/:id/search', () => {
  it('returns 404 when response not in DB', async () => {
    const app = buildApp([]);
    const res = await app.request('/mcp-responses/r-unknown/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'alice', workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with search results when response found in DB', async () => {
    const row = { response_id: 'r-1', context_entities_json: [] };
    const app = buildApp([row]);
    const res = await app.request('/mcp-responses/r-1/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'alice', workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { results: Array<{ entityId: string; score: number }> }; meta: { total: number } };
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]!.entityId).toBe('c1');
    expect(body.data.results[0]!.score).toBe(0.85);
    expect(body.meta.total).toBe(1);
  });

  it('returns 400 for empty query', async () => {
    const app = buildApp([]);
    const res = await app.request('/mcp-responses/r-1/search', {
      method: 'POST',
      body: JSON.stringify({ query: '', workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing workspaceId', async () => {
    const app = buildApp([]);
    const res = await app.request('/mcp-responses/r-1/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'alice' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
