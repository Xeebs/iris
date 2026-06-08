import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createEntitySearchRoutes } from '../routes/entity-search.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/entity-search', () => {
  const mockEngine = {
    searchEntities: vi.fn(),
    suggestFilters: vi.fn(),
  };
  return {
    EntitySearchEngine: vi.fn(() => mockEngine),
    _mockEngine: mockEngine,
  };
});

import { _mockEngine as mockEngine } from '@iris/semantic-core/entity-search';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createEntitySearchRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/', createEntitySearchRoutes(sqlMock));
  return app;
}

beforeEach(() => { vi.clearAllMocks(); });

const searchResponse = {
  results: [{ entityId: 'e-1', entityType: 'contact', label: 'Alice', connectorId: 'hubspot', workspaceId: 'ws-test', attributes: {}, score: 0.9 }],
  total: 1, nextCursor: null, facets: [],
};

describe('POST /entities/search', () => {
  it('returns search results', async () => {
    mockEngine.searchEntities.mockResolvedValueOnce(ok(searchResponse));
    const res = await makeApp().request('/entities/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Alice', filters: 'type:contact' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof searchResponse };
    expect(body.data.results).toHaveLength(1);
  });

  it('uses defaults when body is empty', async () => {
    mockEngine.searchEntities.mockResolvedValueOnce(ok({ ...searchResponse, results: [] }));
    const res = await makeApp().request('/entities/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(200);
    expect(mockEngine.searchEntities).toHaveBeenCalledWith('ws-test', '', '', 50, undefined);
  });

  it('returns 400 for limit > 200', async () => {
    const res = await makeApp().request('/entities/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 999 }),
    });
    expect(res.status).toBe(400);
  });

  it('passes cursor to engine', async () => {
    mockEngine.searchEntities.mockResolvedValueOnce(ok(searchResponse));
    await makeApp().request('/entities/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Alice', cursor: 'e-50' }),
    });
    expect(mockEngine.searchEntities).toHaveBeenCalledWith('ws-test', 'Alice', '', 50, 'e-50');
  });

  it('returns 500 on search error', async () => {
    mockEngine.searchEntities.mockResolvedValueOnce(err(new Error('db error')));
    const res = await makeApp().request('/entities/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /entities/search-suggestions', () => {
  it('returns filter suggestions', async () => {
    mockEngine.suggestFilters.mockResolvedValueOnce(ok(['type:contact', 'type:company']));
    const res = await makeApp().request('/entities/search-suggestions?q=type:');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: string[] };
    expect(body.data).toContain('type:contact');
  });

  it('returns empty list when no matches', async () => {
    mockEngine.suggestFilters.mockResolvedValueOnce(ok([]));
    const res = await makeApp().request('/entities/search-suggestions?q=zzz');
    expect(res.status).toBe(200);
    expect((await res.json() as { data: string[] }).data).toHaveLength(0);
  });
});
