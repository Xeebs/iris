import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVectorStore = { listByType: vi.fn(), getById: vi.fn() };

vi.mock('@iris/semantic-core', () => ({
  VectorStore: vi.fn(() => mockVectorStore),
  retrieveContext: vi.fn(),
}));

vi.mock('@iris/compression', () => ({
  compress: vi.fn(() => ({ content: 'compressed context', entityCount: 2, tokenCount: 200, truncated: false })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

import { retrieveContext } from '@iris/semantic-core';
const mockRetrieve = vi.mocked(retrieveContext);

async function importRoutes() {
  const { createQueryRoutes } = await import('../routes/queries.js');
  return createQueryRoutes;
}

describe('query routes', () => {
  let createQueryRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createQueryRoutes = await importRoutes();
    mockRetrieve.mockResolvedValue({ entities: [{ id: 'e1', type: 'contact', label: 'Alice', attributes: {} } as never], totalCount: 1, truncated: false });
  });

  function buildApp() {
    const app = new Hono();
    app.route('/queries', createQueryRoutes(mockVectorStore as never, 'test-key'));
    return app;
  }

  it('returns 200 with compressed context', async () => {
    const res = await buildApp().request('/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'show me all contacts', workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { content: string; tokenCount: number } };
    expect(body.data.content).toBe('compressed context');
    expect(body.data.tokenCount).toBe(200);
  });

  it('returns 400 when query is missing', async () => {
    const res = await buildApp().request('/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await buildApp().request('/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  it('passes entityTypes filter to retrieveContext', async () => {
    await buildApp().request('/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', workspaceId: 'ws-1', entityTypes: ['contact', 'deal'] }),
    });
    expect(mockRetrieve).toHaveBeenCalledWith(
      'test',
      expect.anything(),
      expect.objectContaining({ entityTypes: ['contact', 'deal'] }),
    );
  });

  it('includes cacheHit and durationMs in response', async () => {
    const res = await buildApp().request('/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', workspaceId: 'ws-1' }),
    });
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toHaveProperty('durationMs');
  });
});
