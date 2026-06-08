import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { makeQueryTemplatesRouter } from '../routes/query-templates.js';

vi.mock('@iris/semantic-core/query-templates', () => {
  const { ok, err } = require('neverthrow');
  const mockTemplate = {
    id: 'tpl-1',
    name: 'Top Contacts',
    query: 'SELECT * FROM contacts ORDER BY name LIMIT {{limit}}',
    parameters: [{ name: 'limit', type: 'number', required: false, defaultValue: 10 }],
    description: 'List top contacts',
    tags: ['crm'],
    visibility: 'workspace',
    workspaceId: 'ws-1',
    createdBy: 'admin',
    createdAt: new Date('2026-01-01'),
    usageCount: 5,
  };

  const MockQueryTemplateManager = vi.fn().mockImplementation(() => ({
    listTemplates: vi.fn().mockResolvedValue(ok({ templates: [mockTemplate], nextCursor: null })),
    createTemplate: vi.fn().mockResolvedValue(ok(mockTemplate)),
    instantiateTemplate: vi.fn().mockResolvedValue(
      ok({ templateId: 'tpl-1', query: 'SELECT * FROM contacts ORDER BY name LIMIT 10', boundParameters: { limit: 10 } }),
    ),
    suggestOptimizations: vi.fn().mockResolvedValue(ok([
      { templateId: 'tpl-1', suggestion: 'Specify explicit column names instead of SELECT *', impactLevel: 'low', reason: 'test' },
    ])),
    trackTemplateUsage: vi.fn().mockResolvedValue(ok(undefined)),
  }));

  return { QueryTemplateManager: MockQueryTemplateManager };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  const fn = vi.fn().mockResolvedValue([{ total_uses: 5, last_used_at: new Date('2026-01-01') }]);
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function makeApp(sql = makeSql()) {
  const app = new Hono();
  app.route('/api/v1/templates', makeQueryTemplatesRouter(sql));
  return app;
}

describe('GET /api/v1/templates', () => {
  it('returns 400 when X-Workspace-Id is missing', async () => {
    const res = await makeApp().request('/api/v1/templates');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('missing_workspace');
  });

  it('returns template list', async () => {
    const res = await makeApp().request('/api/v1/templates', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.hasMore).toBe(false);
  });

  it('passes search query to manager', async () => {
    const res = await makeApp().request('/api/v1/templates?search=contacts', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/templates', () => {
  it('returns 400 for missing workspace header', async () => {
    const res = await makeApp().request('/api/v1/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'T', query: 'Q', createdBy: 'u' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid body', async () => {
    const res = await makeApp().request('/api/v1/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('creates template and returns 201', async () => {
    const res = await makeApp().request('/api/v1/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ name: 'Top Contacts', query: 'SELECT id FROM contacts', createdBy: 'admin' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { name: string } };
    expect(body.data.name).toBe('Top Contacts');
  });
});

describe('PUT /api/v1/templates/:id', () => {
  it('returns 200 on success', async () => {
    const sql = makeSql();
    const res = await makeApp(sql).request('/api/v1/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; updated: boolean } };
    expect(body.data.updated).toBe(true);
  });

  it('returns 500 when db update throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as ReturnType<typeof import('postgres').default>;
    const res = await makeApp(sql).request('/api/v1/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/templates/:id/instantiate', () => {
  it('returns instantiated query', async () => {
    const res = await makeApp().request('/api/v1/templates/tpl-1/instantiate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parameters: { limit: 20 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { query: string } };
    expect(body.data.query).toContain('contacts');
  });

  it('returns 400 for invalid body', async () => {
    const res = await makeApp().request('/api/v1/templates/tpl-1/instantiate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/templates/:id/analytics', () => {
  it('returns analytics data', async () => {
    const res = await makeApp().request('/api/v1/templates/tpl-1/analytics', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { templateId: string; totalUses: number; optimizationSuggestions: unknown[] } };
    expect(body.data.templateId).toBe('tpl-1');
    expect(body.data.totalUses).toBe(5);
    expect(body.data.optimizationSuggestions).toHaveLength(1);
  });
});
