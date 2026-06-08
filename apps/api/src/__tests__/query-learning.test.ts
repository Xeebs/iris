import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createQueryLearningRoutes } from '../routes/query-learning.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/query-learning-engine', () => ({
  learnFromSuccessfulQueries: vi.fn(),
  suggestRelatedQueries: vi.fn(),
  suggestMissingContext: vi.fn(),
  recommendIndexExpansion: vi.fn(),
}));

import {
  learnFromSuccessfulQueries as mockLearn,
  suggestRelatedQueries as mockSuggest,
  suggestMissingContext as mockMissing,
  recommendIndexExpansion as mockRecommend,
} from '@iris/semantic-core/query-learning-engine';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createQueryLearningRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/', createQueryLearningRoutes(sqlMock));
  return app;
}

beforeEach(() => vi.clearAllMocks());

const historyEntry = {
  queryHash: 'abc',
  queryText: 'find contacts',
  entityTypesQueried: ['contact'],
  filtersUsed: {},
  resultCount: 10,
  success: true,
  executedAt: '2026-06-08T00:00:00Z',
};

describe('POST /queries/learn', () => {
  it('returns 201 with patternsUpserted count', async () => {
    (mockLearn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(3));
    const res = await makeApp().request('/queries/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryHistory: [historyEntry] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { patternsUpserted: number } };
    expect(body.data.patternsUpserted).toBe(3);
  });

  it('returns 400 when queryHistory is empty', async () => {
    const res = await makeApp().request('/queries/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryHistory: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on DB failure', async () => {
    (mockLearn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(err(new Error('db error')));
    const res = await makeApp().request('/queries/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryHistory: [historyEntry] }),
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /queries/suggestions', () => {
  it('returns query suggestions', async () => {
    const suggestions = [
      { queryText: 'top deals', queryHash: 'h1', confidence: 0.8, reason: 'common', similarityScore: 0.7 },
    ];
    (mockSuggest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(suggestions));
    const res = await makeApp().request('/queries/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'find contacts', limit: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof suggestions };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.queryText).toBe('top deals');
  });

  it('returns 400 when query is missing', async () => {
    const res = await makeApp().request('/queries/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on DB failure', async () => {
    (mockSuggest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(err(new Error('db error')));
    const res = await makeApp().request('/queries/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'contacts' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /queries/missing-context', () => {
  it('returns missing context candidates', async () => {
    const candidates = [
      { entityType: 'contact', attribute: 'phone', suggestionConfidence: 0.85, useCase: 'Follow-up' },
    ];
    (mockMissing as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(candidates));
    const res = await makeApp().request('/queries/missing-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'find contacts', presentAttributes: ['name', 'email'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof candidates };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.attribute).toBe('phone');
  });

  it('returns 400 when query is missing', async () => {
    const res = await makeApp().request('/queries/missing-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /workspaces/:id/index-expansion-recommendations', () => {
  it('returns connector recommendations', async () => {
    const recs = [
      { connectorType: 'zendesk', entityTypes: ['ticket'], estimatedQueryCoverage: 0.3, rationale: 'high ticket query volume' },
    ];
    (mockRecommend as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(recs));
    const res = await makeApp().request('/workspaces/ws-test/index-expansion-recommendations');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof recs };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.connectorType).toBe('zendesk');
  });

  it('returns 500 on failure', async () => {
    (mockRecommend as ReturnType<typeof vi.fn>).mockResolvedValueOnce(err(new Error('db fail')));
    const res = await makeApp().request('/workspaces/ws-1/index-expansion-recommendations');
    expect(res.status).toBe(500);
  });
});
