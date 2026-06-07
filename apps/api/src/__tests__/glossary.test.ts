import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/glossary', () => ({
  GlossaryService: vi.fn(),
}));

import { GlossaryService } from '@iris/semantic-core/glossary';
import { createGlossaryRoutes } from '../routes/glossary.js';

const WORKSPACE = 'ws-test';
const FAKE_TERM = {
  id: 'term-1',
  workspaceId: WORKSPACE,
  term: 'ARR',
  definition: 'Annual Recurring Revenue',
  exampleValue: '$1.2M',
  status: 'approved' as const,
  approvedBy: null,
  approvedAt: null,
  usageCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeApp(mockMethods: Partial<{
  listTerms: ReturnType<typeof vi.fn>;
  addTerm: ReturnType<typeof vi.fn>;
  deleteTerm: ReturnType<typeof vi.fn>;
  approveTerm: ReturnType<typeof vi.fn>;
  getTermHistory: ReturnType<typeof vi.fn>;
  getTermUsage: ReturnType<typeof vi.fn>;
}>): Hono {
  vi.mocked(GlossaryService).mockImplementation(() => mockMethods as InstanceType<typeof GlossaryService>);
  const fakeSql = {} as Parameters<typeof createGlossaryRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/glossary', createGlossaryRoutes(fakeSql));
  return app;
}

describe('GET /api/v1/glossary', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/glossary');
    expect(res.status).toBe(400);
  });

  it('returns 200 with term list', async () => {
    const { ok } = await import('neverthrow');
    const listTerms = vi.fn().mockResolvedValue(ok([FAKE_TERM]));
    const app = makeApp({ listTerms });
    const res = await app.request(`/api/v1/glossary?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_TERM[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.term).toBe('ARR');
  });

  it('returns 500 when service errors', async () => {
    const { err } = await import('neverthrow');
    const listTerms = vi.fn().mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp({ listTerms });
    const res = await app.request(`/api/v1/glossary?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/glossary/usage', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/glossary/usage');
    expect(res.status).toBe(400);
  });

  it('returns 200 with usage counts', async () => {
    const { ok } = await import('neverthrow');
    const getTermUsage = vi.fn().mockResolvedValue(ok([{ term: 'ARR', usageCount: 15 }]));
    const app = makeApp({ getTermUsage });
    const res = await app.request(`/api/v1/glossary/usage?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { term: string; usageCount: number }[] };
    expect(body.data[0]?.term).toBe('ARR');
    expect(body.data[0]?.usageCount).toBe(15);
  });

  it('returns 500 when service errors', async () => {
    const { err } = await import('neverthrow');
    const getTermUsage = vi.fn().mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp({ getTermUsage });
    const res = await app.request(`/api/v1/glossary/usage?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/glossary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/glossary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 'ARR', definition: 'Annual Recurring Revenue' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid body', async () => {
    const addTerm = vi.fn();
    const app = makeApp({ addTerm });
    const res = await app.request(`/api/v1/glossary?workspaceId=${WORKSPACE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 on success', async () => {
    const { ok } = await import('neverthrow');
    const addTerm = vi.fn().mockResolvedValue(ok(FAKE_TERM));
    const app = makeApp({ addTerm });
    const res = await app.request(`/api/v1/glossary?workspaceId=${WORKSPACE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 'ARR', definition: 'Annual Recurring Revenue', exampleValue: '$1.2M' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof FAKE_TERM };
    expect(body.data.term).toBe('ARR');
  });
});

describe('GET /api/v1/glossary/:term/history', () => {
  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/glossary/ARR/history');
    expect(res.status).toBe(400);
  });

  it('returns 200 with history entries', async () => {
    const { ok } = await import('neverthrow');
    const history = [
      { id: 'h1', termId: 'term-1', workspaceId: WORKSPACE, term: 'ARR', definition: 'Updated def', exampleValue: null, changedBy: 'user-1', changedAt: new Date() },
    ];
    const getTermHistory = vi.fn().mockResolvedValue(ok(history));
    const app = makeApp({ getTermHistory });
    const res = await app.request(`/api/v1/glossary/ARR/history?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof history };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.changedBy).toBe('user-1');
  });
});

describe('PUT /api/v1/glossary/:term/approve', () => {
  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/glossary/ARR/approve', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'user-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when approvedBy is missing', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/glossary/ARR/approve?workspaceId=${WORKSPACE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when term not found', async () => {
    const { ok } = await import('neverthrow');
    const approveTerm = vi.fn().mockResolvedValue(ok(null));
    const app = makeApp({ approveTerm });
    const res = await app.request(`/api/v1/glossary/UNKNOWN/approve?workspaceId=${WORKSPACE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'user-1' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with approved term', async () => {
    const { ok } = await import('neverthrow');
    const approved = { ...FAKE_TERM, status: 'approved' as const, approvedBy: 'user-1' };
    const approveTerm = vi.fn().mockResolvedValue(ok(approved));
    const app = makeApp({ approveTerm });
    const res = await app.request(`/api/v1/glossary/ARR/approve?workspaceId=${WORKSPACE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'user-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof approved };
    expect(body.data.approvedBy).toBe('user-1');
  });
});

describe('DELETE /api/v1/glossary/:term', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/glossary/ARR', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when term not found', async () => {
    const { ok } = await import('neverthrow');
    const deleteTerm = vi.fn().mockResolvedValue(ok(false));
    const app = makeApp({ deleteTerm });
    const res = await app.request(`/api/v1/glossary/NONEXISTENT?workspaceId=${WORKSPACE}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 200 when deleted', async () => {
    const { ok } = await import('neverthrow');
    const deleteTerm = vi.fn().mockResolvedValue(ok(true));
    const app = makeApp({ deleteTerm });
    const res = await app.request(`/api/v1/glossary/ARR?workspaceId=${WORKSPACE}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});
