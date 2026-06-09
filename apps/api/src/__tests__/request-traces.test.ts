import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@iris/semantic-core/request-tracer', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/request-tracer')>(
    '@iris/semantic-core/request-tracer'
  );
  return { ...actual };
});

import { createRequestTracesRoutes } from '../routes/request-traces.js';

function makeSql(responses: Record<string, unknown[]> = {}) {
  return vi.fn((strings: TemplateStringsArray) => {
    const q = strings.raw.join('?');
    for (const [key, rows] of Object.entries(responses)) {
      if (q.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
}

const spanFixture = {
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  parentSpanId: null,
  operationName: 'api.query-context',
  serviceName: 'api',
  durationMs: 145,
  status: 'ok',
  metadata: { method: 'POST', path: '/query-context', statusCode: 200 },
  errors: null,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  workspaceId: 'ws-1',
};

function buildApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/traces', createRequestTracesRoutes(sql as unknown as ReturnType<typeof import('postgres').default>));
  return app;
}

const BASE = 'http://localhost';

describe('request-traces routes', () => {
  let sql: ReturnType<typeof makeSql>;
  let app: Hono;

  beforeEach(() => {
    sql = makeSql({ request_traces: [spanFixture] });
    app = buildApp(sql);
    vi.clearAllMocks();
  });

  describe('GET /traces', () => {
    it('returns 200 with trace list', async () => {
      const res = await app.request(`${BASE}/traces`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toHaveProperty('hasMore');
    });

    it('returns empty data when no traces exist', async () => {
      app = buildApp(makeSql({ request_traces: [] }));
      const res = await app.request(`${BASE}/traces`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('passes operationName filter to tracer', async () => {
      const res = await app.request(`${BASE}/traces?operationName=api.query`);
      expect(res.status).toBe(200);
    });

    it('respects limit query param', async () => {
      const res = await app.request(`${BASE}/traces?limit=10`);
      expect(res.status).toBe(200);
    });

    it('returns 500 when tracer throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/traces`);
      expect(res.status).toBe(500);
    });

    it('includes meta.nextCursor field', async () => {
      const res = await app.request(`${BASE}/traces`);
      const body = await res.json() as { meta: { nextCursor: string | null } };
      expect('nextCursor' in body.meta).toBe(true);
    });
  });

  describe('GET /traces/:traceId', () => {
    it('returns 200 with spans for known trace', async () => {
      const res = await app.request(`${BASE}/traces/${'a'.repeat(32)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 404 when trace not found', async () => {
      app = buildApp(makeSql({ request_traces: [] }));
      const res = await app.request(`${BASE}/traces/nonexistent-trace`);
      expect(res.status).toBe(404);
    });

    it('returns 500 when query throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/traces/some-trace`);
      expect(res.status).toBe(500);
    });

    it('returns all spans for multi-span trace', async () => {
      const span2 = { ...spanFixture, spanId: 'c'.repeat(16) };
      app = buildApp(makeSql({ request_traces: [spanFixture, span2] }));
      const res = await app.request(`${BASE}/traces/${'a'.repeat(32)}`);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(2);
    });
  });

  describe('POST /traces/analyze', () => {
    it('returns 200 with analysis for known trace', async () => {
      const res = await app.request(`${BASE}/traces/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ traceId: 'a'.repeat(32) }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { traceId: string; totalSpans: number } };
      expect(body.data).toHaveProperty('totalSpans');
      expect(body.data).toHaveProperty('criticalPath');
    });

    it('returns 400 when traceId is missing', async () => {
      const res = await app.request(`${BASE}/traces/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is not valid JSON', async () => {
      const res = await app.request(`${BASE}/traces/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });

    it('returns analysis with errorCount field', async () => {
      const errorSpan = { ...spanFixture, status: 'error', spanId: 'c'.repeat(16) };
      app = buildApp(makeSql({ request_traces: [spanFixture, errorSpan] }));
      const res = await app.request(`${BASE}/traces/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ traceId: 'a'.repeat(32) }),
      });
      const body = await res.json() as { data: { errorCount: number } };
      expect(typeof body.data.errorCount).toBe('number');
    });

    it('returns analysis with slowestOperations array', async () => {
      const res = await app.request(`${BASE}/traces/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ traceId: 'a'.repeat(32) }),
      });
      const body = await res.json() as { data: { slowestOperations: unknown[] } };
      expect(Array.isArray(body.data.slowestOperations)).toBe(true);
    });

    it('returns 500 when analysis throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/traces/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ traceId: 'a'.repeat(32) }),
      });
      expect(res.status).toBe(500);
    });

    it('returns totalDurationMs in response', async () => {
      const res = await app.request(`${BASE}/traces/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ traceId: 'a'.repeat(32) }),
      });
      const body = await res.json() as { data: { totalDurationMs: number } };
      expect(typeof body.data.totalDurationMs).toBe('number');
    });
  });
});
