import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createBulkOperationsRoutes } from '../routes/bulk-operations.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const sampleEntities = [
  {
    id: 'contact:1',
    type: 'contact',
    label: 'Alice Smith',
    attributes: { email: 'alice@example.com' },
    relationships: [],
    lastModified: '2026-01-10T00:00:00.000Z',
    sourceId: 'contact:1',
  },
  {
    id: 'contact:2',
    type: 'contact',
    label: 'Bob Jones',
    attributes: { email: 'bob@example.com' },
    relationships: [],
    lastModified: '2026-02-10T00:00:00.000Z',
    sourceId: 'contact:2',
  },
];

type SqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  mockImplementation?: (fn: () => Promise<unknown[]>) => void;
};

function makeSql(returnVal: unknown[] = []): SqlFn {
  const fn = vi.fn().mockResolvedValue(returnVal) as unknown as SqlFn;
  return fn;
}

function makeApp(sql: SqlFn) {
  const app = new Hono();
  app.route('/api/v1/entities', createBulkOperationsRoutes(sql as never));
  return app;
}

describe('POST /api/v1/entities/import', () => {
  it('imports valid JSON records', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ format: 'json', data: JSON.stringify(sampleEntities) }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { importedCount: number; status: string } };
    expect(body.data.importedCount).toBe(2);
    expect(body.data.status).toBe('completed');
  });

  it('imports valid CSV records', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const csv = [
      'id,type,label,attributes,relationships,lastModified,sourceId',
      `contact:3,contact,Carol Day,"{""email"":""carol@example.com""}","[]",2026-01-01T00:00:00.000Z,contact:3`,
    ].join('\n');
    const res = await app.request('/api/v1/entities/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ format: 'csv', data: csv }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { importedCount: number } };
    expect(body.data.importedCount).toBe(1);
  });

  it('returns 400 for missing body', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid JSON data', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'json', data: 'not-json{{{' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PARSE_ERROR');
  });

  it('returns 400 when all records fail validation', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const badData = JSON.stringify([{ id: '', type: '', label: '' }]);
    const res = await app.request('/api/v1/entities/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'json', data: badData }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns jobId in response', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ format: 'json', data: JSON.stringify(sampleEntities) }),
    });
    const body = await res.json() as { data: { jobId: string } };
    expect(typeof body.data.jobId).toBe('string');
    expect(body.data.jobId.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/entities/import/jobs', () => {
  it('returns list of import jobs', async () => {
    const sql = makeSql([{ job_id: 'job1', status: 'completed', record_count: 5 }]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/import/jobs', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('GET /api/v1/entities/import/jobs/:jobId', () => {
  it('returns 404 for unknown job', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/import/jobs/nonexistent', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns job details for known job', async () => {
    const sql = makeSql([{ job_id: 'job1', status: 'completed' }]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/import/jobs/job1', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { job_id: string } };
    expect(body.data.job_id).toBe('job1');
  });
});

describe('GET /api/v1/entities/export', () => {
  it('returns JSON export by default', async () => {
    const sql = makeSql([
      {
        id: 'ws1:contact:1',
        type: 'contact',
        label: 'Alice',
        attributes: {},
        relationships: [],
        last_modified: new Date().toISOString(),
        source_id: 'contact:1',
      },
    ]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/export', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const text = await res.text();
    const parsed = JSON.parse(text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('returns CSV when format=csv', async () => {
    const sql = makeSql([
      {
        id: 'ws1:contact:1',
        type: 'contact',
        label: 'Alice',
        attributes: {},
        relationships: [],
        last_modified: new Date().toISOString(),
        source_id: 'contact:1',
      },
    ]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/export?format=csv', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('id,type,label');
    expect(text).toContain('Alice');
  });

  it('sets content-disposition header', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/export', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('returns 400 for invalid format', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/entities/export?format=xml', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(400);
  });
});
