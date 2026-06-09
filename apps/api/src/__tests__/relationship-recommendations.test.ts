import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeRelationshipRecommendationsRouter } from '../routes/relationship-recommendations.js';

vi.mock('@iris/semantic-core/relationship-recommender', () => {
  const ok = (v: unknown) => ({ isOk: () => true, isErr: () => false, value: v });
  const er = (m: string) => ({ isOk: () => false, isErr: () => true, error: new Error(m), _unsafeUnwrapErr: () => new Error(m) });

  const MockService = vi.fn().mockImplementation(() => ({
    suggestRelationships: vi.fn().mockResolvedValue(ok([{ fromId: 'e1', toId: 'e2', confidence: 0.8 }])),
    autoLinkEntities: vi.fn().mockResolvedValue(ok({ fromId: 'e1', toId: 'e2', relationshipType: 'related_to', confidence: 0.85, autoApproved: true })),
    acceptRelationshipSuggestion: vi.fn().mockResolvedValue(ok(undefined)),
    denyRelationshipSuggestion: vi.fn().mockResolvedValue(ok(undefined)),
    bulkSuggestRelationships: vi.fn().mockResolvedValue(ok([{ entityId: 'e1', suggestions: [] }])),
    getSuggestionMetrics: vi.fn().mockResolvedValue(ok({ totalSuggested: 10, accepted: 7, denied: 3, acceptanceRate: 0.7 })),
    _er: er,
  }));

  return { RelationshipRecommendationService: MockService };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp() {
  const app = new Hono();
  app.route('/api/v1/relationship-recommendations', makeRelationshipRecommendationsRouter(makeSql()));
  return app;
}

describe('GET /entities/:entityId/suggestions', () => {
  it('returns suggestions for entity', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/entities/e1/suggestions');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('returns 404 when entity not found', async () => {
    const { RelationshipRecommendationService } = await import('@iris/semantic-core/relationship-recommender');
    vi.mocked(RelationshipRecommendationService).mockImplementationOnce(() => ({
      suggestRelationships: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('Entity e99 not found') }),
      autoLinkEntities: vi.fn(),
      acceptRelationshipSuggestion: vi.fn(),
      denyRelationshipSuggestion: vi.fn(),
      bulkSuggestRelationships: vi.fn(),
      getSuggestionMetrics: vi.fn(),
    }));
    const res = await buildApp().request('/api/v1/relationship-recommendations/entities/e99/suggestions');
    expect(res.status).toBe(404);
  });
});

describe('POST /auto-link', () => {
  it('creates auto-link with valid body', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/auto-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: 'e1', toId: 'e2', relationshipType: 'related_to', confidence: 0.85 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { autoApproved: boolean } };
    expect(body.data.autoApproved).toBe(true);
  });

  it('returns 400 for missing fields', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/auto-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: 'e1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 422 when confidence below threshold', async () => {
    const { RelationshipRecommendationService } = await import('@iris/semantic-core/relationship-recommender');
    vi.mocked(RelationshipRecommendationService).mockImplementationOnce(() => ({
      suggestRelationships: vi.fn(),
      autoLinkEntities: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('Confidence 0.5 is below threshold') }),
      acceptRelationshipSuggestion: vi.fn(),
      denyRelationshipSuggestion: vi.fn(),
      bulkSuggestRelationships: vi.fn(),
      getSuggestionMetrics: vi.fn(),
    }));
    const res = await buildApp().request('/api/v1/relationship-recommendations/auto-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: 'e1', toId: 'e2', relationshipType: 'related_to', confidence: 0.5 }),
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /feedback/accept', () => {
  it('accepts suggestion', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/feedback/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: 'e1', toId: 'e2' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { accepted: boolean } };
    expect(body.data.accepted).toBe(true);
  });

  it('returns 400 for missing fromId', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/feedback/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toId: 'e2' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /feedback/deny', () => {
  it('denies suggestion', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/feedback/deny', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: 'e1', toId: 'e2' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { denied: boolean } };
    expect(body.data.denied).toBe(true);
  });
});

describe('POST /bulk-suggest', () => {
  it('returns suggestions for multiple entities', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/bulk-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: ['e1', 'e2'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('returns 400 for empty entityIds', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/bulk-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /metrics', () => {
  it('returns suggestion metrics', async () => {
    const res = await buildApp().request('/api/v1/relationship-recommendations/metrics');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { acceptanceRate: number } };
    expect(body.data.acceptanceRate).toBeCloseTo(0.7);
  });
});
