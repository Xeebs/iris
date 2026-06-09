import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  };
});

type SessionRow = {
  session_id: string;
  workspace_id: string;
  question: string;
  intent: { type: string; confidence: number };
  query_plan: Record<string, unknown>;
  follow_up_questions: string[];
  is_favorite: boolean;
  created_at: string;
};

function makeSessionRow(id = 'sess-1'): SessionRow {
  return {
    session_id: id,
    workspace_id: 'ws-1',
    question: 'show me top contacts',
    intent: { type: 'entity-search', confidence: 0.85 },
    query_plan: { entityTypes: ['contact'] },
    follow_up_questions: ['What are their recent activities?', 'Which ones are in enterprise?'],
    is_favorite: false,
    created_at: new Date().toISOString(),
  };
}

function makeSql(responses: Record<string, unknown[]> = {}) {
  const fn = vi.fn((strings: TemplateStringsArray) => {
    const q = Array.from(strings.raw).join('');
    for (const [key, rows] of Object.entries(responses)) {
      if (q.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([makeSessionRow()]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (arr: unknown) => arr;
  (fn as Record<string, unknown>).json = (obj: unknown) => obj;
  return fn;
}

async function buildApp(sql: ReturnType<typeof makeSql>) {
  const { createNlQuerySessionsRoutes } = await import('../routes/nl-query-sessions.js');
  const app = new Hono();
  app.route('/', createNlQuerySessionsRoutes(sql));
  return app;
}

// ─── GET /sessions ────────────────────────────────────────────────────────────

describe('GET /nl-query-sessions/sessions', () => {
  it('returns 200 with data array', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/sessions', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns meta with hasMore and nextCursor', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/sessions', { headers: { 'x-workspace-id': 'ws-1' } });
    const body = (await res.json()) as { meta: { hasMore: boolean; nextCursor: string | null } };
    expect(body.meta).toHaveProperty('hasMore');
    expect(body.meta).toHaveProperty('nextCursor');
  });

  it('maps snake_case to camelCase (sessionId, isFavorite)', async () => {
    const app = await buildApp(makeSql({ 'nlquery_sessions': [makeSessionRow('sess-abc')] }));
    const res = await app.request('/sessions', { headers: { 'x-workspace-id': 'ws-1' } });
    const body = (await res.json()) as { data: Array<{ sessionId: string; isFavorite: boolean }> };
    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty('sessionId');
      expect(body.data[0]).toHaveProperty('isFavorite');
    }
  });

  it('supports favoritesOnly filter', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/sessions?favoritesOnly=true', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
  });

  it('supports cursor-based pagination', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/sessions?cursor=sess-0', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
  });
});

// ─── GET /sessions/:id ────────────────────────────────────────────────────────

describe('GET /nl-query-sessions/sessions/:id', () => {
  it('returns 200 with session and feedback', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([makeSessionRow()])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sessions/sess-1', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sessionId: string; feedback: unknown } };
    expect(body.data).toHaveProperty('sessionId');
    expect(body.data).toHaveProperty('feedback');
  });

  it('returns 404 for unknown session', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sessions/unknown', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(404);
  });

  it('includes followUpQuestions in response', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([makeSessionRow()])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sessions/sess-1', { headers: { 'x-workspace-id': 'ws-1' } });
    const body = (await res.json()) as { data: { followUpQuestions: unknown[] } };
    expect(body.data).toHaveProperty('followUpQuestions');
  });
});

// ─── POST /sessions/:id/favorite ──────────────────────────────────────────────

describe('POST /nl-query-sessions/sessions/:id/favorite', () => {
  it('returns 200 with isFavorite=true', async () => {
    const sql = vi.fn().mockResolvedValue([{ session_id: 'sess-1', is_favorite: true }]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sessions/sess-1/favorite', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { isFavorite: boolean } };
    expect(body.data.isFavorite).toBe(true);
  });

  it('returns 404 for unknown session', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sessions/unknown/favorite', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /sessions/:id/question/:qid ──────────────────────────────────────

describe('DELETE /nl-query-sessions/sessions/:id/question/:qid', () => {
  it('returns 200 with removedIndex', async () => {
    const row = makeSessionRow();
    const sql = vi.fn()
      .mockResolvedValueOnce([{ session_id: 'sess-1', follow_up_questions: row.follow_up_questions }])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sessions/sess-1/question/0', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { removedIndex: number; remainingCount: number } };
    expect(body.data.removedIndex).toBe(0);
    expect(body.data.remainingCount).toBe(row.follow_up_questions.length - 1);
  });

  it('returns 404 for unknown session', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sessions/unknown/question/0', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric question index', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/sessions/sess-1/question/abc', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when question index is out of range', async () => {
    const row = makeSessionRow();
    const sql = vi.fn().mockResolvedValue([{ session_id: 'sess-1', follow_up_questions: row.follow_up_questions }]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request(`/sessions/sess-1/question/${row.follow_up_questions.length + 5}`, {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });
});
