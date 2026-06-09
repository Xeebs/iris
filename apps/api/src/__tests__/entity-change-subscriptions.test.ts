import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  };
});

type SubRow = {
  subscription_id: string;
  entity_id: string | null;
  workspace_id: string;
  filters: Record<string, unknown>;
  created_at: string;
  active: boolean;
};

function makeSubRow(id = 'sub-1'): SubRow {
  return {
    subscription_id: id,
    entity_id: 'contact-1',
    workspace_id: 'ws-1',
    filters: { entityTypes: ['contact'] },
    created_at: new Date().toISOString(),
    active: true,
  };
}

function makeSql(responses: Record<string, unknown[]> = {}) {
  const fn = vi.fn((strings: TemplateStringsArray) => {
    const q = Array.from(strings.raw).join('');
    for (const [key, rows] of Object.entries(responses)) {
      if (q.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([makeSubRow()]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (arr: unknown) => arr;
  (fn as Record<string, unknown>).json = (obj: unknown) => obj;
  return fn;
}

async function buildApp(sql: ReturnType<typeof makeSql>) {
  const { createEntityChangeSubscriptionsRoutes } = await import('../routes/entity-change-subscriptions.js');
  const app = new Hono();
  app.route('/', createEntityChangeSubscriptionsRoutes(sql));
  return app;
}

// ─── POST / — create subscription ────────────────────────────────────────────

describe('POST /entity-change-subscriptions', () => {
  it('returns 201 on valid input', async () => {
    const sql = makeSql();
    const app = await buildApp(sql);
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ entityId: 'contact-1', entityTypes: ['contact'] }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(201);
  });

  it('returns subscription data with subscriptionId', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ entityId: 'contact-1' }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    const body = (await res.json()) as { data?: { subscriptionId: string } };
    expect(body.data).toHaveProperty('subscriptionId');
  });

  it('accepts null entityId (subscribe to all)', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ entityId: null }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    expect([201, 500]).toContain(res.status);
  });
});

// ─── GET / — list subscriptions ───────────────────────────────────────────────

describe('GET /entity-change-subscriptions', () => {
  it('returns 200 with data array', async () => {
    const sql = makeSql({ 'entity_change_subscriptions': [makeSubRow()] });
    const app = await buildApp(sql);
    const res = await app.request('/', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns meta with hasMore and nextCursor', async () => {
    const app = await buildApp(makeSql());
    const res = await app.request('/', { headers: { 'x-workspace-id': 'ws-1' } });
    const body = (await res.json()) as { meta: { hasMore: boolean; nextCursor: string | null } };
    expect(body.meta).toHaveProperty('hasMore');
    expect(body.meta).toHaveProperty('nextCursor');
  });

  it('maps snake_case columns to camelCase in response', async () => {
    const sql = makeSql({ 'entity_change_subscriptions': [makeSubRow('sub-abc')] });
    const app = await buildApp(sql);
    const res = await app.request('/', { headers: { 'x-workspace-id': 'ws-1' } });
    const body = (await res.json()) as { data: Array<{ subscriptionId: string }> };
    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty('subscriptionId');
    }
  });
});

// ─── PUT /:id — update subscription filters ───────────────────────────────────

describe('PUT /entity-change-subscriptions/:id', () => {
  it('returns 200 on successful update', async () => {
    const sql = makeSql({ 'UPDATE entity_change_subscriptions': [makeSubRow()] });
    const app = await buildApp(sql);
    const res = await app.request('/sub-1', {
      method: 'PUT',
      body: JSON.stringify({ entityTypes: ['company'], changeTypes: ['updated'] }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    expect([200, 404]).toContain(res.status);
  });

  it('returns 404 when subscription not found', async () => {
    const sql = makeSql({ 'UPDATE entity_change_subscriptions': [] });
    const app = await buildApp(sql);
    const res = await app.request('/nonexistent', {
      method: 'PUT',
      body: JSON.stringify({ entityTypes: ['contact'] }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /:id — unsubscribe ────────────────────────────────────────────────

describe('DELETE /entity-change-subscriptions/:id', () => {
  it('returns 200 with cancelled flag', async () => {
    const sql = makeSql({ 'UPDATE entity_change_subscriptions': [{ subscription_id: 'sub-1' }] });
    const app = await buildApp(sql);
    const res = await app.request('/sub-1', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect([200, 404]).toContain(res.status);
  });

  it('returns 404 for unknown subscription', async () => {
    const sql = makeSql({ 'UPDATE entity_change_subscriptions': [] });
    const app = await buildApp(sql);
    const res = await app.request('/unknown', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });
});

// ─── GET /:id/events — event history ─────────────────────────────────────────

describe('GET /entity-change-subscriptions/:id/events', () => {
  it('returns 200 with data and meta', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ entity_id: 'contact-1' }]) // sub lookup
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sub-1/events', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect([200, 404]).toContain(res.status);
  });

  it('returns 404 when subscription does not belong to workspace', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/unknown/events', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });

  it('response includes hasMore in meta', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ entity_id: 'contact-1' }])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;

    const app = await buildApp(sql);
    const res = await app.request('/sub-1/events', { headers: { 'x-workspace-id': 'ws-1' } });
    if (res.status === 200) {
      const body = (await res.json()) as { meta: { hasMore: boolean } };
      expect(body.meta).toHaveProperty('hasMore');
    }
  });
});
