import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@iris/semantic-core/entity-change-stream', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/entity-change-stream')>(
    '@iris/semantic-core/entity-change-stream'
  );
  return { ...actual };
});

import { createEntityChangeStreamRoutes } from '../routes/entity-change-stream.js';

function makeSql() {
  return vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/entities', createEntityChangeStreamRoutes(sql as unknown as ReturnType<typeof import('postgres').default>));
  return app;
}

const BASE = 'http://localhost';

describe('entity-change-stream routes', () => {
  let sql: ReturnType<typeof makeSql>;
  let app: Hono;

  beforeEach(() => {
    sql = makeSql();
    app = buildApp(sql);
    vi.clearAllMocks();
  });

  describe('POST /entities/subscriptions', () => {
    it('returns 201 with subscription', async () => {
      const res = await app.request(`${BASE}/entities/subscriptions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: 'contact:123' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { data: { subscriptionId: string } };
      expect(body.data.subscriptionId).toHaveLength(32);
    });

    it('accepts null entityId for workspace subscription', async () => {
      const res = await app.request(`${BASE}/entities/subscriptions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: null }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/entities/subscriptions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: 'contact:1' }),
      });
      expect(res.status).toBe(500);
    });

    it('accepts entityType and changeType filters', async () => {
      const res = await app.request(`${BASE}/entities/subscriptions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: null,
          filters: { entityTypes: ['contact'], changeTypes: ['updated'] },
        }),
      });
      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /entities/subscriptions/:id', () => {
    it('returns 200 when cancellation succeeds', async () => {
      const res = await app.request(`${BASE}/entities/subscriptions/sub-abc`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { cancelled: boolean } };
      expect(body.data.cancelled).toBe(true);
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/entities/subscriptions/sub-x`, { method: 'DELETE' });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /entities/subscriptions', () => {
    it('returns 200 with subscription list', async () => {
      const res = await app.request(`${BASE}/entities/subscriptions`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/entities/subscriptions`);
      expect(res.status).toBe(500);
    });
  });

  describe('GET /entities/:entityId/changes', () => {
    it('returns 200 with empty changes array', async () => {
      const res = await app.request(`${BASE}/entities/contact:123/changes`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 400 for invalid since date', async () => {
      const res = await app.request(`${BASE}/entities/contact:1/changes?since=not-a-date`);
      expect(res.status).toBe(400);
    });

    it('respects limit parameter', async () => {
      const res = await app.request(`${BASE}/entities/contact:1/changes?limit=5`);
      expect(res.status).toBe(200);
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/entities/contact:1/changes`);
      expect(res.status).toBe(500);
    });
  });

  describe('POST /entities/changes', () => {
    it('returns 201 when change is emitted', async () => {
      const res = await app.request(`${BASE}/entities/changes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: 'contact:123',
          entityType: 'contact',
          changeType: 'updated',
          previousValue: { email: 'old@x.com' },
          newValue: { email: 'new@x.com' },
          source: 'hubspot',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { data: { changeId: string; notification: string } };
      expect(body.data.changeId).toHaveLength(32);
      expect(typeof body.data.notification).toBe('string');
    });

    it('returns 400 when entityId is missing', async () => {
      const res = await app.request(`${BASE}/entities/changes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'contact', changeType: 'updated' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/entities/changes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: 'e1', entityType: 'contact', changeType: 'created' }),
      });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /entities/changes', () => {
    it('returns 200 with change feed', async () => {
      const res = await app.request(`${BASE}/entities/changes`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('accepts entityType filter', async () => {
      const res = await app.request(`${BASE}/entities/changes?entityType=contact`);
      expect(res.status).toBe(200);
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/entities/changes`);
      expect(res.status).toBe(500);
    });
  });
});
