import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createPiiMaskingAuditRoutes } from '../routes/pii-masking-audit.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

function makeSql(returnVal: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnVal);
}

function makeApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/api/v1/admin/pii', createPiiMaskingAuditRoutes(sql as never));
  return app;
}

describe('GET /api/v1/admin/pii/access-audit', () => {
  it('returns 200 with events array', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/access-audit', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('includes meta.hasMore in response', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/access-audit', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    const body = await res.json() as { meta: { hasMore: boolean } };
    expect(typeof body.meta.hasMore).toBe('boolean');
  });
});

describe('GET /api/v1/admin/pii/fields', () => {
  it('returns 200 with rules array', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('PUT /api/v1/admin/pii/fields/:connectorId/:fieldName/strategy', () => {
  it('returns 200 on valid strategy update', async () => {
    const sql = makeSql([{ connector_id: 'hubspot', field_name: 'email', strategy: 'hash', updated_at: new Date() }]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields/hubspot/email/strategy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ strategy: 'hash' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { strategy: string } };
    expect(body.data.strategy).toBe('hash');
  });

  it('returns 400 for invalid strategy', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields/hubspot/email/strategy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'scramble' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for missing body', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields/hubspot/email/strategy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/admin/pii/fields/bulk-rule', () => {
  it('returns 200 with rulesUpdated count', async () => {
    const sql = makeSql([
      { field_name: 'email', connector_id: 'hubspot' },
      { connector_id: 'hubspot', field_name: 'email', strategy: 'hash', updated_at: new Date() },
    ]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields/bulk-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ fieldPattern: '*email*', strategy: 'hash', applyToAllConnectors: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { rulesUpdated: number } };
    expect(typeof body.data.rulesUpdated).toBe('number');
  });

  it('returns 400 for missing fieldPattern', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields/bulk-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'hash' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/admin/pii/fields/preview', () => {
  it('returns masked value for redact strategy', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'alice@example.com', strategy: 'redact' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { masked: string; original: string } };
    expect(body.data.masked).toBe('[REDACTED]');
    expect(body.data.original).toBe('alice@example.com');
  });

  it('returns keep_last_4 format', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '4111111111111234', strategy: 'keep_last_4' }),
    });
    const body = await res.json() as { data: { masked: string } };
    expect(body.data.masked).toBe('****1234');
  });

  it('returns 400 for missing value', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/pii/fields/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'hash' }),
    });
    expect(res.status).toBe(400);
  });
});
