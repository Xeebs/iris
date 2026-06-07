import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/workflow-templates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@iris/semantic-core/workflow-templates')>();
  return {
    ...actual,
    WorkflowTemplateService: vi.fn(),
  };
});

import { WorkflowTemplateService } from '@iris/semantic-core/workflow-templates';
import { createWorkflowTemplateRoutes } from '../routes/workflow-templates.js';

const WORKSPACE = 'ws-abc';
const TMPL_ID = 'tmpl-1';

const FAKE_TEMPLATE = {
  id: TMPL_ID,
  workspaceId: WORKSPACE,
  templateName: 'Daily Sales Summary',
  description: 'Test',
  triggerType: 'calendar' as const,
  triggerConfig: { cron: '0 9 * * 1-5' },
  mcpCalls: [{ tool: 'query-context', params: {} }],
  responseFormat: 'markdown' as const,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeApp(methods: Partial<InstanceType<typeof WorkflowTemplateService>>) {
  vi.mocked(WorkflowTemplateService).mockImplementation(() => methods as InstanceType<typeof WorkflowTemplateService>);
  const fakeSql = {} as Parameters<typeof createWorkflowTemplateRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/workflow-templates', createWorkflowTemplateRoutes(fakeSql));
  return app;
}

describe('GET /api/v1/workflow-templates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workflow-templates');
    expect(res.status).toBe(400);
  });

  it('returns 200 with template list', async () => {
    const listTemplates = vi.fn().mockResolvedValue(ok([FAKE_TEMPLATE]));
    const app = makeApp({ listTemplates });
    const res = await app.request(`/api/v1/workflow-templates?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_TEMPLATE[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(TMPL_ID);
  });

  it('returns 500 on service error', async () => {
    const listTemplates = vi.fn().mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp({ listTemplates });
    const res = await app.request(`/api/v1/workflow-templates?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/workflow-templates/:id', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/workflow-templates/${TMPL_ID}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when template not found', async () => {
    const getTemplate = vi.fn().mockResolvedValue(ok(null));
    const app = makeApp({ getTemplate });
    const res = await app.request(`/api/v1/workflow-templates/missing?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(404);
  });

  it('returns 200 with template', async () => {
    const getTemplate = vi.fn().mockResolvedValue(ok(FAKE_TEMPLATE));
    const app = makeApp({ getTemplate });
    const res = await app.request(`/api/v1/workflow-templates/${TMPL_ID}?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof FAKE_TEMPLATE };
    expect(body.data.id).toBe(TMPL_ID);
  });
});

describe('POST /api/v1/workflow-templates', () => {
  it('returns 400 on invalid body', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/workflow-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateName: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 with created template', async () => {
    const createTemplate = vi.fn().mockResolvedValue(ok(FAKE_TEMPLATE));
    const app = makeApp({ createTemplate });
    const res = await app.request('/api/v1/workflow-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE,
        templateName: 'Daily Sales Summary',
        triggerType: 'calendar',
        triggerConfig: { cron: '0 9 * * 1-5' },
        mcpCalls: [{ tool: 'query-context', params: {} }],
        responseFormat: 'markdown',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe(TMPL_ID);
  });

  it('returns 409 on duplicate name', async () => {
    const createTemplate = vi.fn().mockResolvedValue(err(new Error('duplicate key value violates unique')));
    const app = makeApp({ createTemplate });
    const res = await app.request('/api/v1/workflow-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE,
        templateName: 'Daily Sales Summary',
        mcpCalls: [{ tool: 'query-context', params: {} }],
      }),
    });
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/v1/workflow-templates/:id', () => {
  it('returns 400 on missing workspaceId', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/workflow-templates/${TMPL_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateName: 'New Name' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    const updateTemplate = vi.fn().mockResolvedValue(ok(null));
    const app = makeApp({ updateTemplate });
    const res = await app.request(`/api/v1/workflow-templates/${TMPL_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, templateName: 'New' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with updated template', async () => {
    const updated = { ...FAKE_TEMPLATE, templateName: 'Updated' };
    const updateTemplate = vi.fn().mockResolvedValue(ok(updated));
    const app = makeApp({ updateTemplate });
    const res = await app.request(`/api/v1/workflow-templates/${TMPL_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE, templateName: 'Updated' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { templateName: string } };
    expect(body.data.templateName).toBe('Updated');
  });
});

describe('DELETE /api/v1/workflow-templates/:id', () => {
  it('returns 400 when workspaceId missing', async () => {
    const app = makeApp({});
    const res = await app.request(`/api/v1/workflow-templates/${TMPL_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    const deleteTemplate = vi.fn().mockResolvedValue(ok(false));
    const app = makeApp({ deleteTemplate });
    const res = await app.request(`/api/v1/workflow-templates/${TMPL_ID}?workspaceId=${WORKSPACE}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful delete', async () => {
    const deleteTemplate = vi.fn().mockResolvedValue(ok(true));
    const app = makeApp({ deleteTemplate });
    const res = await app.request(`/api/v1/workflow-templates/${TMPL_ID}?workspaceId=${WORKSPACE}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});
