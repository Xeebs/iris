import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/data-import-export', () => ({
  parseCSV: vi.fn().mockReturnValue([{ id: '1', name: 'Alice', company: 'Acme' }]),
  parseJSON: vi.fn().mockReturnValue([{ id: '1', name: 'Alice', company: 'Acme' }]),
  detectSchema: vi.fn().mockReturnValue({ columns: ['id', 'name', 'company'], sampleRows: [], rowCount: 1 }),
  validateMapping: vi.fn().mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
    mappedCount: 1,
    unmappedColumns: [],
  }),
  transformRows: vi.fn().mockReturnValue({
    entities: [{
      id: 'import:contact:1',
      type: 'contact',
      label: 'Alice',
      attributes: { company: 'Acme' },
      relationships: [],
      lastModified: new Date(),
      sourceId: 'import:contact:1',
    }],
    errors: [],
  }),
  batchInsert: vi.fn().mockResolvedValue({ inserted: 1, durationMs: 10 }),
  serializeToCSV: vi.fn().mockReturnValue('id,type,label\nimport:contact:1,contact,Alice'),
  serializeToJSON: vi.fn().mockReturnValue('{"data":[],"count":0}'),
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
  MAX_ENTITY_COUNT: 50_000,
}));

const sqlMock = vi.fn().mockResolvedValue([]);

import { createDataImportExportRoutes } from '../routes/data-import-export.js';

function makeApp(): Hono {
  const sql = sqlMock as unknown as Parameters<typeof createDataImportExportRoutes>[0];
  const app = new Hono();
  app.route('/data', createDataImportExportRoutes(sql));
  return app;
}

const validImportBody = {
  workspaceId: 'ws-1',
  format: 'csv',
  content: 'id,name,company\n1,Alice,Acme',
  mapping: {
    entityType: 'contact',
    labelColumn: 'name',
    idColumn: 'id',
    attributeMap: { company: 'company' },
  },
  connectorId: 'test',
};

describe('POST /data/import', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/data/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when required body fields are missing', async () => {
    const app = makeApp();
    const res = await app.request('/data/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'csv', content: 'a,b\n1,2' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 422 when mapping is invalid', async () => {
    const { validateMapping } = await import('@iris/semantic-core/data-import-export');
    vi.mocked(validateMapping).mockReturnValueOnce({
      valid: false,
      errors: ['labelColumn "name" not found'],
      warnings: [],
      mappedCount: 0,
      unmappedColumns: [],
    });

    const app = makeApp();
    const res = await app.request('/data/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validImportBody),
    });
    expect(res.status).toBe(422);
  });

  it('returns 201 on successful import', async () => {
    const app = makeApp();
    const res = await app.request('/data/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validImportBody),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { jobId: string; inserted: number } };
    expect(body.data.jobId).toBeDefined();
    expect(body.data.inserted).toBe(1);
  });

  it('includes warnings in successful response', async () => {
    const { validateMapping } = await import('@iris/semantic-core/data-import-export');
    vi.mocked(validateMapping).mockReturnValueOnce({
      valid: true,
      errors: [],
      warnings: ['1 column not mapped'],
      mappedCount: 1,
      unmappedColumns: ['extra'],
    });

    const app = makeApp();
    const res = await app.request('/data/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validImportBody),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { warnings: string[] } };
    expect(body.data.warnings).toHaveLength(1);
  });
});

describe('GET /data/export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/data/export');
    expect(res.status).toBe(400);
  });

  it('returns 200 with serialized content for JSON format', async () => {
    const app = makeApp();
    const res = await app.request('/data/export?workspaceId=ws-1&format=json');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('returns 200 for CSV format', async () => {
    const app = makeApp();
    const res = await app.request('/data/export?workspaceId=ws-1&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('.csv');
  });

  it('defaults to JSON format when format not specified', async () => {
    const app = makeApp();
    const res = await app.request('/data/export?workspaceId=ws-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('POST /data/import/schema', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when content is missing', async () => {
    const app = makeApp();
    const res = await app.request('/data/import/schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'csv' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with detected schema', async () => {
    const app = makeApp();
    const res = await app.request('/data/import/schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'csv', content: 'id,name\n1,Alice' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { columns: string[] } };
    expect(body.data.columns).toContain('id');
  });
});

describe('GET /data/jobs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/data/jobs');
    expect(res.status).toBe(400);
  });

  it('returns 200 with empty jobs list', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const app = makeApp();
    const res = await app.request('/data/jobs?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns job rows mapped to camelCase', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: 'job-1',
      type: 'import',
      status: 'completed',
      format: 'csv',
      record_count: 5,
      file_name: null,
      file_size_bytes: null,
      error_message: null,
      result_url: null,
      created_by: 'api',
      created_at: new Date('2026-01-01'),
      completed_at: new Date('2026-01-01'),
    }]);
    const app = makeApp();
    const res = await app.request('/data/jobs?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string; status: string }> };
    expect(body.data[0]!.id).toBe('job-1');
    expect(body.data[0]!.status).toBe('completed');
  });
});
