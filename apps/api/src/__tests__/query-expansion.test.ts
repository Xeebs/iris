import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeQueryExpansionRouter } from '../routes/query-expansion.js';

vi.mock('@iris/semantic-core/query-expansion-engine', () => {
  const ok = (v: unknown) => ({ isOk: () => true, isErr: () => false, value: v });
  const er = (m: string) => ({ isOk: () => false, isErr: () => true, error: new Error(m) });

  const MockService = vi.fn().mockImplementation(() => ({
    expandQuery: vi.fn().mockResolvedValue(ok({ sessionId: 'sess1', query: 'test', stage: 1, results: [{ entityId: 'e1', entityType: 'contact', label: 'Alice', score: 0.8, stage: 1 }], directions: [], feedback: [], createdAt: new Date() })),
    refineContextByFeedback: vi.fn().mockResolvedValue(ok([{ entityId: 'e1', entityType: 'contact', label: 'Alice', score: 0.9, stage: 1 }])),
    recordFeedback: vi.fn().mockResolvedValue(ok(undefined)),
    getSession: vi.fn().mockResolvedValue(ok({ sessionId: 'sess1', query: 'test', stage: 1, results: [], directions: [], feedback: [], createdAt: new Date() })),
    _er: er,
  }));

  return { QueryExpansionEngine: MockService };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp() {
  const app = new Hono();
  app.route('/api/v1/query-expansion', makeQueryExpansionRouter(makeSql()));
  return app;
}

describe('POST /query-expansion/expand', () => {
  it('returns 201 with session', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'find contacts' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { sessionId: string } };
    expect(body.data.sessionId).toBe('sess1');
  });

  it('returns 400 for missing query', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('accepts feedback in body', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', stage: 2, feedback: [{ entityId: 'e1', mark: 'useful' }] }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 for invalid mark', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', feedback: [{ entityId: 'e1', mark: 'bad' }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /query-expansion/refine', () => {
  it('returns re-ranked results', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [{ entityId: 'e1', entityType: 'contact', label: 'Alice', score: 0.8, stage: 1 }],
        feedback: [{ entityId: 'e1', mark: 'irrelevant' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entityId: string }[] };
    expect(body.data).toHaveLength(1);
  });

  it('returns 400 for empty results', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [], feedback: [{ entityId: 'e1', mark: 'useful' }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /query-expansion/sessions/:sessionId/feedback', () => {
  it('records feedback', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/sessions/sess1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: [{ entityId: 'e1', mark: 'useful' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 for empty feedback', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/sessions/sess1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /query-expansion/sessions/:sessionId', () => {
  it('returns session', async () => {
    const res = await buildApp().request('/api/v1/query-expansion/sessions/sess1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { sessionId: string } };
    expect(body.data.sessionId).toBe('sess1');
  });

  it('returns 404 for unknown session', async () => {
    const { QueryExpansionEngine } = await import('@iris/semantic-core/query-expansion-engine');
    vi.mocked(QueryExpansionEngine).mockImplementationOnce(() => ({
      expandQuery: vi.fn(),
      refineContextByFeedback: vi.fn(),
      recordFeedback: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('Session missing not found') }),
    }));
    const res = await buildApp().request('/api/v1/query-expansion/sessions/missing');
    expect(res.status).toBe(404);
  });
});
