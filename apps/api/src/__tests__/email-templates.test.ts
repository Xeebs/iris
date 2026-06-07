import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/email-templates', () => ({
  EmailTemplateService: vi.fn(),
}));
vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { EmailTemplateService } from '@iris/semantic-core/email-templates';
import { createEmailTemplateRoutes } from '../routes/email-templates.js';

const TEMPLATE = {
  id: 'tmpl-1',
  workspaceId: 'ws-1',
  name: 'alert-default',
  subject: 'Alert: {{alertName}}',
  htmlBody: '<p>{{message}}</p>',
  textBody: '{{message}}',
  variables: ['alertName', 'message'],
  isDefault: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function okResult<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value, error: null };
}
function errResult(msg: string) {
  const e = new Error(msg);
  return { isOk: () => false, isErr: () => true, value: undefined, error: e };
}

let mockService: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockService = {
    list: vi.fn().mockResolvedValue(okResult([TEMPLATE])),
    get: vi.fn().mockResolvedValue(okResult(TEMPLATE)),
    create: vi.fn().mockResolvedValue(okResult(TEMPLATE)),
    upsert: vi.fn().mockResolvedValue(okResult(TEMPLATE)),
    delete: vi.fn().mockResolvedValue(okResult(undefined)),
    render: vi.fn().mockResolvedValue(okResult({ subject: 'Alert: High CPU', htmlBody: '<p>CPU high</p>', textBody: 'CPU high' })),
  };
  vi.mocked(EmailTemplateService).mockImplementation(() => mockService as never);
});

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-1'); await next(); });
  app.route('/email-templates', createEmailTemplateRoutes({} as never));
  return app;
}

describe('GET /email-templates', () => {
  it('returns list of templates', async () => {
    const res = await makeApp().request('/email-templates');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it('returns 500 on service error', async () => {
    mockService.list!.mockResolvedValue(errResult('db error'));
    const res = await makeApp().request('/email-templates');
    expect(res.status).toBe(500);
  });

  it('returns 401 when workspaceId missing', async () => {
    const app = new Hono();
    app.route('/email-templates', createEmailTemplateRoutes({} as never));
    const res = await app.request('/email-templates');
    expect(res.status).toBe(401);
  });
});

describe('GET /email-templates/:id', () => {
  it('returns template when found', async () => {
    const res = await makeApp().request('/email-templates/tmpl-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof TEMPLATE };
    expect(body.data.id).toBe('tmpl-1');
  });

  it('returns 404 when template not found', async () => {
    mockService.get!.mockResolvedValue(okResult(null));
    const res = await makeApp().request('/email-templates/missing');
    expect(res.status).toBe(404);
  });
});

describe('POST /email-templates', () => {
  it('creates a template and returns 201', async () => {
    const res = await makeApp().request('/email-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'alert-default',
        subject: 'Alert: {{alertName}}',
        htmlBody: '<p>{{message}}</p>',
        textBody: '{{message}}',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof TEMPLATE };
    expect(body.data.name).toBe('alert-default');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await makeApp().request('/email-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate name', async () => {
    mockService.create!.mockResolvedValue(errResult('unique constraint violation'));
    const res = await makeApp().request('/email-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup', subject: 's', htmlBody: 'h', textBody: 't' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('PUT /email-templates/:name', () => {
  it('upserts template and returns 200', async () => {
    const res = await makeApp().request('/email-templates/alert-default', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'New subject', htmlBody: '<p>new</p>', textBody: 'new' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /email-templates/:id', () => {
  it('deletes and returns ok', async () => {
    const res = await makeApp().request('/email-templates/tmpl-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('POST /email-templates/render', () => {
  it('renders template and returns rendered content', async () => {
    const res = await makeApp().request('/email-templates/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'tmpl-1', variables: { alertName: 'High CPU', message: 'CPU high' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { subject: string } };
    expect(body.data.subject).toBe('Alert: High CPU');
  });

  it('returns 404 when template not found during render', async () => {
    mockService.render!.mockResolvedValue(errResult('Template not found'));
    const res = await makeApp().request('/email-templates/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'missing', variables: {} }),
    });
    expect(res.status).toBe(404);
  });
});
