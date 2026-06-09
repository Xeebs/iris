import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createSdkDownloadsRoutes } from '../routes/sdk-downloads.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/sdk-generator', () => {
  const SdkCodeGenerator = vi.fn().mockImplementation(() => ({
    parseToolSchema: vi.fn((def: Record<string, unknown>) => ({ name: String(def['name']), description: '', inputSchema: {} })),
    generateTypeDefinitions: vi.fn().mockReturnValue({ language: 'typescript', typeCode: 'type X = {}', requestType: 'XRequest', responseType: 'XResponse' }),
    generateClientLibrary: vi.fn().mockReturnValue({
      language: 'typescript',
      code: 'export class IrisClient {}',
      className: 'IrisClient',
      methods: ['queryContext', 'listEntities'],
      version: '0.1.0',
    }),
    outputDocs: vi.fn().mockReturnValue({
      markdown: '# Iris SDK',
      methods: [{ name: 'queryContext', signature: 'queryContext()', description: 'desc', example: 'client.queryContext({})', errorCodes: [] }],
    }),
  }));
  return { SdkCodeGenerator };
});

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp(sqlRows: unknown[] = []) {
  const app = new Hono();
  app.route('/sdks', createSdkDownloadsRoutes(makeSql(sqlRows)));
  return app;
}

// ─── GET /sdks/languages ──────────────────────────────────────────────────────

describe('GET /sdks/languages', () => {
  it('returns 200 with all supported languages', async () => {
    const app = buildApp();
    const res = await app.request('/sdks/languages');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ language: string }> };
    expect(body.data.map((d) => d.language)).toContain('typescript');
    expect(body.data.map((d) => d.language)).toContain('python');
    expect(body.data.map((d) => d.language)).toContain('go');
  });
});

// ─── GET /sdks/tools ──────────────────────────────────────────────────────────

describe('GET /sdks/tools', () => {
  it('returns 200 with tools list', async () => {
    const app = buildApp();
    const res = await app.request('/sdks/tools');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ name: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('name');
  });
});

// ─── POST /sdks/generate/:language ───────────────────────────────────────────

describe('POST /sdks/generate/:language', () => {
  it('returns 201 with jobId for typescript', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ job_id: 'job-ts-1', created_at: new Date() }])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;
    const app = new Hono();
    app.route('/sdks', createSdkDownloadsRoutes(sql));

    const res = await app.request('/sdks/generate/typescript', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { jobId: string; language: string } };
    expect(body.data.language).toBe('typescript');
    expect(body.data.jobId).toBe('job-ts-1');
  });

  it('returns 400 for unsupported language', async () => {
    const app = buildApp();
    const res = await app.request('/sdks/generate/ruby', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('accepts version parameter', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ job_id: 'job-2', created_at: new Date() }])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;
    const app = new Hono();
    app.route('/sdks', createSdkDownloadsRoutes(sql));

    const res = await app.request('/sdks/generate/python', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', version: '1.0.0' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
  });
});

// ─── GET /sdks/jobs/:jobId/status ─────────────────────────────────────────────

describe('GET /sdks/jobs/:jobId/status', () => {
  it('returns 200 with job details when found', async () => {
    const jobRow = {
      job_id: 'job-1',
      workspace_id: 'ws-1',
      language: 'typescript',
      status: 'complete',
      tool_count: 5,
      download_url: '/api/v1/sdks/artifacts/job-1',
      error_message: null,
      sdk_version: '0.1.0',
      created_at: new Date(),
      completed_at: new Date(),
    };
    const app = buildApp([jobRow]);
    const res = await app.request('/sdks/jobs/job-1/status');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('complete');
  });

  it('returns 404 when job not found', async () => {
    const app = buildApp([]);
    const res = await app.request('/sdks/jobs/nonexistent/status');
    expect(res.status).toBe(404);
  });
});

// ─── GET /sdks/jobs ───────────────────────────────────────────────────────────

describe('GET /sdks/jobs', () => {
  it('returns 200 with jobs array', async () => {
    const app = buildApp([]);
    const res = await app.request('/sdks/jobs?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ─── GET /sdks/preview/:language ─────────────────────────────────────────────

describe('GET /sdks/preview/:language', () => {
  it('returns 200 with code preview for typescript', async () => {
    const app = buildApp();
    const res = await app.request('/sdks/preview/typescript');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { code: string; methods: string[] } };
    expect(typeof body.data.code).toBe('string');
    expect(Array.isArray(body.data.methods)).toBe(true);
  });

  it('returns 200 for python preview', async () => {
    const app = buildApp();
    const res = await app.request('/sdks/preview/python');
    expect(res.status).toBe(200);
  });

  it('returns 400 for unsupported language', async () => {
    const app = buildApp();
    const res = await app.request('/sdks/preview/rust');
    expect(res.status).toBe(400);
  });
});
