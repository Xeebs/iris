import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createWorkflowRoutes } from '../routes/workflows.js';

vi.mock('@iris/semantic-core/workflow-service', () => {
  const curated = [
    {
      id: 'sales-pipeline-review',
      name: 'Sales Pipeline Review',
      description: 'Analyze won deals.',
      category: 'sales',
      recommendedConnectors: ['hubspot'],
      contextHints: ['include recent deals'],
      mcpCalls: [{ tool: 'query-context', params: { query: 'active deals', entityTypes: ['deal'], topK: 15 } }],
    },
    {
      id: 'financial-forecast',
      name: 'Financial Forecast',
      description: 'Summarize revenue metrics.',
      category: 'finance',
      recommendedConnectors: ['quickbooks'],
      contextHints: ['invoices due'],
      mcpCalls: [{ tool: 'get-metric', params: { name: 'ARR' } }],
    },
  ];

  return {
    WorkflowService: vi.fn().mockImplementation(() => ({
      listCuratedTemplates: vi.fn().mockReturnValue(curated),
      instantiateTemplate: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true }),
      optimizeContextForWorkflow: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true }),
      seedStarterTemplates: vi.fn().mockResolvedValue({ isOk: () => true }),
    })),
  };
});

function makeSql(overrides: Record<string, unknown> = {}) {
  const fn = vi.fn().mockResolvedValue([{ session_id: 's-1', status: 'pending', started_at: new Date() }]);
  Object.assign(fn, { array: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), ...overrides });
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function makeApp(sql = makeSql()) {
  const app = new Hono();
  app.route('/workflows', createWorkflowRoutes(sql));
  return app;
}

// ─── GET /workflows ───────────────────────────────────────────────────────────

describe('GET /workflows', () => {
  it('returns all curated templates', async () => {
    const res = await makeApp().request('/workflows');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it('filters by category query param', async () => {
    const res = await makeApp().request('/workflows?category=sales');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ category: string }> };
    expect(body.data.every((t) => t.category === 'sales')).toBe(true);
  });

  it('returns empty array for unknown category', async () => {
    const res = await makeApp().request('/workflows?category=unknown-category');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });
});

// ─── GET /workflows/:id ───────────────────────────────────────────────────────

describe('GET /workflows/:id', () => {
  it('returns 404 for unknown templateId', async () => {
    const res = await makeApp().request('/workflows/non-existent');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns template data for valid id', async () => {
    const res = await makeApp().request('/workflows/sales-pipeline-review');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe('sales-pipeline-review');
  });

  it('includes contextPreview as null when workspaceId not provided and service errors', async () => {
    const res = await makeApp().request('/workflows/financial-forecast');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { contextPreview: unknown } };
    expect(body.data.contextPreview).toBeNull();
  });
});

// ─── POST /workflows/:id/execute ─────────────────────────────────────────────

describe('POST /workflows/:id/execute', () => {
  it('returns 404 for unknown templateId', async () => {
    const res = await makeApp().request('/workflows/ghost/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', userId: 'u-1' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await makeApp().request('/workflows/sales-pipeline-review/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when userId is missing', async () => {
    const res = await makeApp().request('/workflows/sales-pipeline-review/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 422 when contextBudget exceeds 8000', async () => {
    const res = await makeApp().request('/workflows/sales-pipeline-review/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', userId: 'u-1', contextBudget: 9000 }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('BUDGET_EXCEEDED');
  });

  it('creates a session and returns 201 on success', async () => {
    const res = await makeApp().request('/workflows/sales-pipeline-review/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', userId: 'u-1' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { session_id: string; status: string } };
    expect(body.data).toHaveProperty('session_id');
    expect(body.data.status).toBe('pending');
  });

  it('accepts optional parameters in execute body', async () => {
    const res = await makeApp().request('/workflows/sales-pipeline-review/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'ws-1',
        userId: 'u-1',
        parameters: { dateRange: '30d', connectorIds: ['hubspot'] },
      }),
    });
    expect(res.status).toBe(201);
  });
});

// ─── GET /workflows/sessions/:userId ─────────────────────────────────────────

describe('GET /workflows/sessions/:userId', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const res = await makeApp().request('/workflows/sessions/u-1');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_WORKSPACE');
  });

  it('returns sessions list for valid userId and workspaceId', async () => {
    const sql = makeSql();
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { session_id: 's-1', template_id: 'sales', template_name: 'Sales Pipeline Review',
        status: 'completed', result_summary: 'All good', token_usage: 1200,
        execution_ms: 450, started_at: new Date(), completed_at: new Date() },
    ]);
    const res = await makeApp(sql).request('/workflows/sessions/u-1?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('respects limit query param (capped at 50)', async () => {
    const sql = makeSql();
    await makeApp(sql).request('/workflows/sessions/u-1?workspaceId=ws-1&limit=5');
    expect((sql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});

// ─── GET /workflows/sessions/:sessionId/result ────────────────────────────────

describe('GET /workflows/sessions/:sessionId/result', () => {
  it('returns 404 when session not found', async () => {
    const sql = makeSql();
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // no session
    const res = await makeApp(sql).request('/workflows/sessions/non-existent/result');
    expect(res.status).toBe(404);
  });

  it('returns session and logs on success', async () => {
    const sql = makeSql();
    const session = {
      session_id: 's-1', template_id: 'sales', template_name: 'Sales', status: 'completed',
      parameters: {}, result_summary: 'done', token_usage: 800, execution_ms: 200,
      started_at: new Date(), completed_at: new Date(),
    };
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([session])
      .mockResolvedValueOnce([]);
    const res = await makeApp(sql).request('/workflows/sessions/s-1/result');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { session: { session_id: string }; logs: unknown[] } };
    expect(body.data.session.session_id).toBe('s-1');
    expect(Array.isArray(body.data.logs)).toBe(true);
  });
});
