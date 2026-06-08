import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createStreamingContextRoutes } from '../routes/streaming-context.js';

// ─── SQL mock helpers ─────────────────────────────────────────────────────────

function makeSql(...responses: unknown[][]) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? [];
    return Promise.resolve(r);
  });
  (fn as unknown as Record<string, unknown>).array = vi.fn((v: unknown) => v);
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

// ─── Request helpers ──────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
  workspaceId = 'ws-1',
) {
  const app = createStreamingContextRoutes(makeSql());
  const headers: Record<string, string> = { 'x-workspace-id': workspaceId };
  if (body) headers['content-type'] = 'application/json';

  return app.request(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── Helpers that carry the sql instance ─────────────────────────────────────

function makeApp(sql: ReturnType<typeof makeSql>) {
  const app = createStreamingContextRoutes(sql);
  const request = (
    method: string,
    path: string,
    body?: unknown,
    workspaceId = 'ws-1',
  ) => {
    const headers: Record<string, string> = { 'x-workspace-id': workspaceId };
    if (body) headers['content-type'] = 'application/json';
    return app.request(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };
  return request;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /stream', () => {
  it('returns 401 when workspaceId header is missing', async () => {
    const app = createStreamingContextRoutes(makeSql());
    const res = await app.request('/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'contacts' }),
    });
    expect(res.status).toBe(401);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = createStreamingContextRoutes(makeSql());
    const res = await app.request('/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when query is missing', async () => {
    const res = await makeRequest('POST', '/stream', { tokenBudget: 1000 });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when query is empty string', async () => {
    const res = await makeRequest('POST', '/stream', { query: '' });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('streams meta event followed by done when no entities match', async () => {
    const sql = makeSql([]);
    const req = makeApp(sql);
    const res = await req('POST', '/stream', { query: 'contacts', tokenBudget: 2000 });
    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
    const events = lines.map((l) => JSON.parse(l.replace('data: ', '')) as { event: string });

    expect(events[0]?.event).toBe('meta');
    const done = events.find((e) => e.event === 'done');
    expect(done).toBeDefined();
  });

  it('streams entity events for matching rows', async () => {
    const row = {
      id: 'ent-1',
      entity_type: 'contact',
      label: 'Alice Smith',
      attributes: { email: 'alice@example.com' },
      source_connector_id: 'hubspot',
      last_modified: '2026-01-01T00:00:00Z',
    };
    const sql = makeSql([row]);
    const req = makeApp(sql);
    const res = await req('POST', '/stream', { query: 'Alice', tokenBudget: 2000 });

    const text = await res.text();
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
    const events = lines.map((l) => JSON.parse(l.replace('data: ', '')) as { event: string; data: Record<string, unknown> });

    const entityEvent = events.find((e) => e.event === 'entity');
    expect(entityEvent).toBeDefined();
    expect(entityEvent?.data['id']).toBe('ent-1');
    expect(entityEvent?.data['label']).toBe('Alice Smith');
  });

  it('truncates when token budget is exceeded', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `ent-${i}`,
      entity_type: 'contact',
      label: `Contact ${i}`,
      attributes: { note: 'x'.repeat(500) },
      source_connector_id: null,
      last_modified: null,
    }));
    const sql = makeSql(rows);
    const req = makeApp(sql);
    const res = await req('POST', '/stream', { query: 'contact', tokenBudget: 200 });

    const text = await res.text();
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
    const events = lines.map((l) => JSON.parse(l.replace('data: ', '')) as { event: string; data: Record<string, unknown> });
    const done = events.find((e) => e.event === 'done');
    expect(done?.data['truncated']).toBe(true);
  });

  it('assigns high confidence tier to first result', async () => {
    const row = {
      id: 'ent-0',
      entity_type: 'deal',
      label: 'Big Deal',
      attributes: {},
      source_connector_id: null,
      last_modified: null,
    };
    const sql = makeSql([row]);
    const req = makeApp(sql);
    const res = await req('POST', '/stream', { query: 'Big Deal', tokenBudget: 2000 });

    const text = await res.text();
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
    const events = lines.map((l) => JSON.parse(l.replace('data: ', '')) as { event: string; data: Record<string, unknown> });
    const entity = events.find((e) => e.event === 'entity');
    expect(entity?.data['confidenceTier']).toBe('high');
    expect(entity?.data['rank']).toBe(0);
  });

  it('assigns relevanceScore between 0 and 1', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `ent-${i}`,
      entity_type: 'contact',
      label: `C ${i}`,
      attributes: {},
      source_connector_id: null,
      last_modified: null,
    }));
    const sql = makeSql(rows);
    const req = makeApp(sql);
    const res = await req('POST', '/stream', { query: 'C', tokenBudget: 4000 });

    const text = await res.text();
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
    const events = lines.map((l) => JSON.parse(l.replace('data: ', '')) as { event: string; data: Record<string, unknown> });
    const entities = events.filter((e) => e.event === 'entity');

    for (const e of entities) {
      const score = e.data['relevanceScore'] as number;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('done event reports correct entity count', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `ent-${i}`,
      entity_type: 'contact',
      label: `C ${i}`,
      attributes: {},
      source_connector_id: null,
      last_modified: null,
    }));
    const sql = makeSql(rows);
    const req = makeApp(sql);
    const res = await req('POST', '/stream', { query: 'C', tokenBudget: 4000 });

    const text = await res.text();
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
    const events = lines.map((l) => JSON.parse(l.replace('data: ', '')) as { event: string; data: Record<string, unknown> });
    const done = events.find((e) => e.event === 'done');
    expect(done?.data['totalEntities']).toBe(3);
    expect(done?.data['truncated']).toBe(false);
  });

  it('streams error event on SQL failure', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('DB unavailable'));
    (fn as unknown as Record<string, unknown>).array = vi.fn((v: unknown) => v);
    const sql = fn as unknown as ReturnType<typeof import('postgres').default>;

    const app = createStreamingContextRoutes(sql);
    const res = await app.request('/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ query: 'test', tokenBudget: 1000 }),
    });

    const text = await res.text();
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
    const events = lines.map((l) => JSON.parse(l.replace('data: ', '')) as { event: string; data: Record<string, unknown> });
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.data['message']).toContain('DB unavailable');
  });
});

describe('GET /stream/metrics', () => {
  it('returns 401 when workspaceId header is missing', async () => {
    const app = createStreamingContextRoutes(makeSql());
    const res = await app.request('/stream/metrics', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('returns aggregated metrics', async () => {
    const metricsRow = {
      avg_duration_ms: '120',
      p95_duration_ms: '350',
      avg_tokens: '800',
      total_requests: '42',
      truncation_rate: '5.0',
    };
    const sql = makeSql([metricsRow]);
    const app = createStreamingContextRoutes(sql);
    const res = await app.request('/stream/metrics', {
      method: 'GET',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: Record<string, unknown> };
    expect(json.data['avgDurationMs']).toBe(120);
    expect(json.data['totalRequests']).toBe(42);
    expect(json.data['truncationRatePct']).toBe(5.0);
  });

  it('returns zeros when no data', async () => {
    const sql = makeSql([{}]);
    const app = createStreamingContextRoutes(sql);
    const res = await app.request('/stream/metrics', {
      method: 'GET',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    const json = await res.json() as { data: Record<string, unknown> };
    expect(json.data['avgDurationMs']).toBe(0);
    expect(json.data['totalRequests']).toBe(0);
  });

  it('returns 500 on SQL error', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('timeout'));
    (fn as unknown as Record<string, unknown>).array = vi.fn((v: unknown) => v);
    const sql = fn as unknown as ReturnType<typeof import('postgres').default>;

    const app = createStreamingContextRoutes(sql);
    const res = await app.request('/stream/metrics', {
      method: 'GET',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(500);
  });
});
