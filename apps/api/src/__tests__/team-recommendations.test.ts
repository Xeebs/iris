import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { makeTeamRecommendationsRouter } from '../routes/team-recommendations.js';

vi.mock('@iris/semantic-core/team-context-recommender', () => {
  const { ok, err } = require('neverthrow');
  const recs = [
    { teamId: 'team-1', entityId: 'e1', entityType: 'contact', score: 82, reasons: ['Popular across the team'] },
  ];
  const usage = [{ entityType: 'contact', totalAccesses: 30, uniqueEntities: 5 }];
  const expansion = [{ entityId: 'e2', entityType: 'company', suggestion: 'Underused', potentialValue: 80 }];
  const predictions = [{ entityType: 'deal', entityId: 'e3', affinityScore: 0.9 }];

  const MockTeamContextRecommender = vi.fn().mockImplementation(() => ({
    generateTeamRecommendations: vi.fn().mockResolvedValue(ok(recs)),
    analyzeTeamContextUsage: vi.fn().mockResolvedValue(ok(usage)),
    suggestContextExpansionForTeam: vi.fn().mockResolvedValue(ok(expansion)),
    predictContextNeedsByRole: vi.fn().mockResolvedValue(ok(predictions)),
    recordContextAccess: vi.fn().mockResolvedValue(ok(undefined)),
    saveContextPreferences: vi.fn().mockResolvedValue(ok(undefined)),
  }));

  return { TeamContextRecommender: MockTeamContextRecommender };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function makeApp() {
  const app = new Hono();
  app.route('/api/v1', makeTeamRecommendationsRouter(makeSql()));
  return app;
}

describe('GET /api/v1/teams/:id/recommended-contexts', () => {
  it('returns recommendations', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/recommended-contexts');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('accepts topK query param', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/recommended-contexts?topK=5');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/teams/:id/usage', () => {
  it('returns usage analysis', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('accepts window query param', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/usage?window=7d');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/teams/:id/expansion-suggestions', () => {
  it('returns expansion suggestions', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/expansion-suggestions');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('PUT /api/v1/teams/:id/context-preferences', () => {
  it('saves preferences and returns ok', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/context-preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferences: { 'e1': 'pin', 'e2': 'dismiss' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { updated: boolean } };
    expect(body.data.updated).toBe(true);
  });

  it('returns 400 for invalid body', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/context-preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferences: { 'e1': 'invalid-action' } }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/teams/:id/context-access', () => {
  it('records access and returns 201', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/context-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roleId: 'r1', entityId: 'e1', entityType: 'contact' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 for missing fields', async () => {
    const res = await makeApp().request('/api/v1/teams/team-1/context-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roleId: 'r1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/roles/:id/context-predictions', () => {
  it('returns predictions for role', async () => {
    const res = await makeApp().request('/api/v1/roles/admin/context-predictions');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});
