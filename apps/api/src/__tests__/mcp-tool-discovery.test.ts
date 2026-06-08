import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMcpToolDiscoveryRouter } from '../routes/mcp-tool-discovery.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeApp(sqlMock?: unknown) {
  const sql = (sqlMock ?? vi.fn().mockResolvedValue([])) as ReturnType<typeof import('postgres').default>;
  return makeMcpToolDiscoveryRouter(sql);
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-workspace-id': 'ws1', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('GET /mcp/tools', () => {
  it('returns all tools', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(5);
    expect(body.meta.total).toBe(body.data.length);
  });

  it('filters by search query', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/?search=bulk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.every((t: { name: string }) => t.name.includes('bulk'))).toBe(true);
  });
});

describe('GET /mcp/tools/:name/usage-stats', () => {
  it('returns usage stats', async () => {
    const sql = vi.fn().mockResolvedValue([{ invocation_count: 42, avg_latency_ms: 150, error_count: 2 }]);
    const app = makeApp(sql);
    const res = await app.fetch(req('/query-context/usage-stats'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.toolName).toBe('query-context');
  });
});

describe('GET /mcp/tools/:name/examples', () => {
  it('returns examples for known tool', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/query-context/examples'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown tool', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/nonexistent-tool/examples'));
    expect(res.status).toBe(404);
  });
});
