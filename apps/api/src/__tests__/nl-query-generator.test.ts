import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@iris/semantic-core/nl-query-generator', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/nl-query-generator')>(
    '@iris/semantic-core/nl-query-generator'
  );
  return { ...actual };
});

import { createNlQueryGeneratorRoutes } from '../routes/nl-query-generator.js';

function makeSql() {
  return vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/queries', createNlQueryGeneratorRoutes(sql as unknown as ReturnType<typeof import('postgres').default>));
  return app;
}

const BASE = 'http://localhost';

describe('nl-query-generator routes', () => {
  let sql: ReturnType<typeof makeSql>;
  let app: Hono;

  beforeEach(() => {
    sql = makeSql();
    app = buildApp(sql);
    vi.clearAllMocks();
  });

  describe('POST /queries/natural-language', () => {
    it('returns 200 with a session', async () => {
      const res = await app.request(`${BASE}/queries/natural-language`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'find all contacts' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { sessionId: string } };
      expect(body.data.sessionId).toHaveLength(32);
    });

    it('returns session with intent field', async () => {
      const res = await app.request(`${BASE}/queries/natural-language`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'show deals trending up' }),
      });
      const body = await res.json() as { data: { intent: { type: string } } };
      expect(['metric-lookup', 'entity-search', 'trend-analysis', 'comparison', 'aggregation']).toContain(body.data.intent.type);
    });

    it('returns session with queryPlan field', async () => {
      const res = await app.request(`${BASE}/queries/natural-language`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'count contacts' }),
      });
      const body = await res.json() as { data: { queryPlan: { intentType: string } } };
      expect(body.data.queryPlan).toHaveProperty('intentType');
      expect(body.data.queryPlan).toHaveProperty('limit');
    });

    it('returns follow-up questions array', async () => {
      const res = await app.request(`${BASE}/queries/natural-language`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'find open deals' }),
      });
      const body = await res.json() as { data: { followUpQuestions: unknown[] } };
      expect(Array.isArray(body.data.followUpQuestions)).toBe(true);
    });

    it('returns 400 when question is missing', async () => {
      const res = await app.request(`${BASE}/queries/natural-language`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contextBudget: 2000 }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts custom contextBudget', async () => {
      const res = await app.request(`${BASE}/queries/natural-language`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'find contacts', contextBudget: 500 }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /queries/natural-language/feedback', () => {
    it('returns 200 when feedback is recorded', async () => {
      const res = await app.request(`${BASE}/queries/natural-language/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-123', helpful: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { recorded: boolean } };
      expect(body.data.recorded).toBe(true);
    });

    it('returns 400 when sessionId is missing', async () => {
      const res = await app.request(`${BASE}/queries/natural-language/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ helpful: true }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts negative feedback with notes', async () => {
      const res = await app.request(`${BASE}/queries/natural-language/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'ses-1', helpful: false, notes: 'Results were wrong' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/queries/natural-language/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'ses-1', helpful: true }),
      });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /queries/natural-language/history', () => {
    it('returns 200 with empty history', async () => {
      const res = await app.request(`${BASE}/queries/natural-language/history`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toHaveProperty('hasMore');
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/queries/natural-language/history`);
      expect(res.status).toBe(500);
    });
  });

  describe('POST /queries/natural-language/classify', () => {
    it('returns 200 with classified intent', async () => {
      const res = await app.request(`${BASE}/queries/natural-language/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'how many contacts total' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { type: string; confidence: number } };
      expect(body.data.type).toBe('aggregation');
      expect(typeof body.data.confidence).toBe('number');
    });

    it('returns 400 when question is missing', async () => {
      const res = await app.request(`${BASE}/queries/natural-language/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
});
