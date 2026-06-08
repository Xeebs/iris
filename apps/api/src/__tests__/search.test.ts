import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/hybrid-search-engine', () => {
  const mockSearch = vi.fn();
  return {
    HybridSearchEngine: vi.fn().mockImplementation(() => ({ search: mockSearch })),
    searchRequestSchema: {
      safeParse: vi.fn(),
    },
    __mockSearch: mockSearch,
  };
});

import { createSearchRoutes } from '../routes/search.js';
import { HybridSearchEngine, searchRequestSchema } from '@iris/semantic-core/hybrid-search-engine';

const mockSearch = (HybridSearchEngine as ReturnType<typeof vi.fn>).mock.results[0]?.value?.search
  ?? vi.fn();

function makeApp() {
  const sql = vi.fn() as unknown as Parameters<typeof createSearchRoutes>[0];
  const app = new Hono();
  app.route('/search', createSearchRoutes(sql));
  return app;
}

const validBody = {
  workspaceId: 'ws-1',
  query: 'open deals',
};

const successResponse = {
  results: [
    {
      id: 'e-1',
      entityType: 'deal',
      label: 'Big Deal',
      attributes: { amount: 50000 },
      sourceConnectorId: 'hubspot',
      lastModified: '2026-05-01T00:00:00Z',
      relevanceScore: 0.012,
    },
  ],
  total: 1,
  hasMore: false,
  durationMs: 42,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /search', () => {
  it('returns 400 for missing body', async () => {
    (searchRequestSchema.safeParse as ReturnType<typeof vi.fn>).mockReturnValue({
      success: false,
      error: { message: 'workspaceId required', issues: [] },
    });

    const app = makeApp();
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid JSON', async () => {
    const app = makeApp();
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_JSON');
  });

  it('returns 200 with results on success', async () => {
    (searchRequestSchema.safeParse as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      data: { ...validBody, limit: 20, offset: 0, filters: {}, sortBy: 'relevance', includeSuggestions: false, explainScoring: false, hybridWeights: { bm25: 0.4, semantic: 0.6 } },
    });

    const { ok } = await import('neverthrow');
    const engineInstance = { search: vi.fn().mockResolvedValue(ok(successResponse)) };
    (HybridSearchEngine as ReturnType<typeof vi.fn>).mockImplementation(() => engineInstance);

    const app = makeApp();
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { data: typeof successResponse };
    expect(json.data.results).toHaveLength(1);
    expect(json.data.total).toBe(1);
  });

  it('returns 500 when engine returns err', async () => {
    (searchRequestSchema.safeParse as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      data: { ...validBody, limit: 20, offset: 0, filters: {}, sortBy: 'relevance', includeSuggestions: false, explainScoring: false, hybridWeights: { bm25: 0.4, semantic: 0.6 } },
    });

    const { err } = await import('neverthrow');
    const engineInstance = { search: vi.fn().mockResolvedValue(err(new Error('DB fail'))) };
    (HybridSearchEngine as ReturnType<typeof vi.fn>).mockImplementation(() => engineInstance);

    const app = makeApp();
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(500);
    const json = await res.json() as { error: { code: string; message: string } };
    expect(json.error.code).toBe('SEARCH_ERROR');
    expect(json.error.message).toBe('DB fail');
  });
});
