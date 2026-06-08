import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createQueryExplanationRoutes } from '../routes/query-explanation.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/query-explainer', () => ({
  QueryExplainer: vi.fn().mockImplementation(() => ({
    explainRetrieval: vi.fn().mockReturnValue({
      query: 'find contacts',
      totalRetrieved: 2,
      entityTypeDistribution: { contact: 2 },
      explanations: [
        {
          entity: { id: 'e:1', type: 'contact', label: 'Alice', attributes: {}, relationships: [], lastModified: new Date(), sourceId: 'e:1' },
          score: 0.9,
          scoring: { entityId: 'e:1', totalScore: 0.95, vectorSimilarity: 0.9, freshnessBonus: 0.05, relationshipBonus: 0, typeMatchBonus: 0, label: 'Alice', type: 'contact' },
          relevanceReason: 'semantic similarity 90%, recently updated',
        },
      ],
      anomalies: [],
      expansionSuggestions: [],
      avgScore: 0.9,
    }),
  })),
}));

function makeApp() {
  const app = new Hono();
  app.route('/api/v1/queries', createQueryExplanationRoutes());
  return app;
}

const validBody = {
  query: 'find contacts',
  results: [
    {
      entity: {
        id: 'e:1',
        type: 'contact',
        label: 'Alice',
        attributes: {},
        relationships: [],
        lastModified: '2026-01-10T00:00:00.000Z',
        sourceId: 'e:1',
      },
      score: 0.9,
    },
  ],
};

describe('POST /api/v1/queries/:id/explain', () => {
  it('returns 200 with explanation', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { query: string; totalRetrieved: number } };
    expect(body.data.query).toBe('find contacts');
    expect(body.data.totalRetrieved).toBe(2);
  });

  it('returns 400 for missing query field', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for missing results field', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid body', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when score is out of range', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', results: [{ ...validBody.results[0], score: 1.5 }] }),
    });
    expect(res.status).toBe(400);
  });

  it('response includes anomalies array', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const body = await res.json() as { data: { anomalies: unknown[] } };
    expect(Array.isArray(body.data.anomalies)).toBe(true);
  });

  it('response includes entityTypeDistribution', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const body = await res.json() as { data: { entityTypeDistribution: Record<string, number> } };
    expect(body.data.entityTypeDistribution).toBeDefined();
    expect(body.data.entityTypeDistribution['contact']).toBe(2);
  });

  it('response includes expansionSuggestions', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const body = await res.json() as { data: { expansionSuggestions: unknown[] } };
    expect(Array.isArray(body.data.expansionSuggestions)).toBe(true);
  });

  it('response includes avgScore', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/queries/q-001/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const body = await res.json() as { data: { avgScore: number } };
    expect(typeof body.data.avgScore).toBe('number');
  });
});
