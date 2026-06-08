import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createSloAdminRoutes } from '../routes/slo-admin.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

function makeSql(returnVal: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnVal);
}

function makeApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/api/v1/admin/slos', createSloAdminRoutes(sql as never));
  return app;
}

describe('GET /api/v1/admin/slos', () => {
  it('returns 200 with attainments array', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/slos', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('POST /api/v1/admin/slos', () => {
  it('returns 201 for a valid SLO definition', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/slos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ name: 'api-latency', metric: 'p95_latency_ms', target: 0.99 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { name: string } };
    expect(body.data.name).toBe('api-latency');
  });

  it('returns 400 for target > 1', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/slos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad', metric: 'foo', target: 1.5 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing name', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/slos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric: 'foo', target: 0.99 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/slos/violations', () => {
  it('returns 200 with violations array', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/slos/violations', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('POST /api/v1/admin/slos/events', () => {
  it('returns 200 for a valid event', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/slos/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ sloName: 'api-latency', metricValue: 1200, met: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 for missing sloName', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/slos/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metricValue: 100, met: true }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/admin/slos/detect', () => {
  it('returns 200 with violationsDetected count', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/slos/detect', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { violationsDetected: number } };
    expect(typeof body.data.violationsDetected).toBe('number');
  });
});
