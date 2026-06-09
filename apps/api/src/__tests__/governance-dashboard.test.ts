import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createGovernanceDashboardRoutes } from '../routes/governance-dashboard.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp(sqlRows: unknown[] = []) {
  const app = new Hono();
  app.route('/governance', createGovernanceDashboardRoutes(makeSql(sqlRows)));
  return app;
}

// ─── Lineage ──────────────────────────────────────────────────────────────────

describe('GET /governance/lineage', () => {
  it('returns 200 with empty nodes when no data', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/lineage?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { nodes: unknown[] } };
    expect(Array.isArray(body.data.nodes)).toBe(true);
  });

  it('defaults workspaceId to "default"', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/lineage');
    expect(res.status).toBe(200);
  });
});

// ─── Audit Summary ────────────────────────────────────────────────────────────

describe('GET /governance/audit-summary', () => {
  it('returns 200 with events array', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/audit-summary?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { events: unknown[] } };
    expect(Array.isArray(body.data.events)).toBe(true);
  });

  it('accepts limit and offset params', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/audit-summary?limit=10&offset=20');
    expect(res.status).toBe(200);
    const body = await res.json() as { meta: { limit: number; offset: number } };
    expect(body.meta.limit).toBe(10);
    expect(body.meta.offset).toBe(20);
  });
});

// ─── Retention Policies ───────────────────────────────────────────────────────

describe('POST /governance/retention-policies', () => {
  it('returns 201 with created policy on success', async () => {
    const sql = vi.fn().mockResolvedValue([{
      policy_id: 'pol-1',
      workspace_id: 'ws-1',
      connector_id: 'hubspot',
      entity_type: 'contact',
      ttl_days: 90,
      applies_to_labels: [],
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    }]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;
    const app = new Hono();
    app.route('/governance', createGovernanceDashboardRoutes(sql));

    const res = await app.request('/governance/retention-policies', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', connectorId: 'hubspot', entityType: 'contact', ttlDays: 90 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { ttlDays: number } };
    expect(body.data.ttlDays).toBe(90);
  });

  it('returns 400 for missing connectorId', async () => {
    const app = buildApp();
    const res = await app.request('/governance/retention-policies', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', entityType: 'contact', ttlDays: 90 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative ttlDays', async () => {
    const app = buildApp();
    const res = await app.request('/governance/retention-policies', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', connectorId: 'hubspot', entityType: 'contact', ttlDays: -1 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /governance/retention-policies', () => {
  it('returns 200 with policies array', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/retention-policies?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ─── Compliance Status ────────────────────────────────────────────────────────

describe('GET /governance/compliance-status', () => {
  it('returns default not_assessed status when no record', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/compliance-status?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { gdprStatus: string } };
    expect(body.data.gdprStatus).toBe('not_assessed');
  });

  it('returns stored status when record exists', async () => {
    const sql = vi.fn().mockResolvedValue([{
      compliance_id: 'c-1',
      workspace_id: 'ws-1',
      gdpr_status: 'compliant',
      hipaa_status: 'in_progress',
      soc2_status: 'not_assessed',
      gdpr_cert_expires_at: null,
      hipaa_cert_expires_at: null,
      soc2_cert_expires_at: null,
      last_audit_at: null,
      scope_summary: 'Full audit scope',
      created_at: new Date(),
      updated_at: new Date(),
    }]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;
    const app = new Hono();
    app.route('/governance', createGovernanceDashboardRoutes(sql));

    const res = await app.request('/governance/compliance-status?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { gdprStatus: string; hipaaStatus: string } };
    expect(body.data.gdprStatus).toBe('compliant');
    expect(body.data.hipaaStatus).toBe('in_progress');
  });
});

describe('PUT /governance/compliance-status', () => {
  it('returns 200 on valid update', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/compliance-status', {
      method: 'PUT',
      body: JSON.stringify({ workspaceId: 'ws-1', gdprStatus: 'compliant' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status value', async () => {
    const app = buildApp();
    const res = await app.request('/governance/compliance-status', {
      method: 'PUT',
      body: JSON.stringify({ workspaceId: 'ws-1', gdprStatus: 'unknown_status' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── DSR Queue ────────────────────────────────────────────────────────────────

describe('POST /governance/dsr-queue', () => {
  it('returns 201 with requestId on valid submission', async () => {
    const sql = vi.fn().mockResolvedValue([{
      request_id: 'req-1',
      status: 'pending',
      submitted_at: new Date(),
      deadline_at: new Date(Date.now() + 30 * 86400_000),
    }]) as unknown as ReturnType<typeof import('postgres').default>;
    (sql as Record<string, unknown>).array = (a: unknown) => a;
    (sql as Record<string, unknown>).json = (o: unknown) => o;
    const app = new Hono();
    app.route('/governance', createGovernanceDashboardRoutes(sql));

    const res = await app.request('/governance/dsr-queue', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        requesterEmail: 'user@example.com',
        requestType: 'deletion',
        entityIds: ['entity-1', 'entity-2'],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { requestId: string; status: string } };
    expect(body.data.requestId).toBe('req-1');
    expect(body.data.status).toBe('pending');
  });

  it('returns 400 for invalid email', async () => {
    const app = buildApp();
    const res = await app.request('/governance/dsr-queue', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        requesterEmail: 'not-an-email',
        requestType: 'deletion',
        entityIds: ['e-1'],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty entityIds', async () => {
    const app = buildApp();
    const res = await app.request('/governance/dsr-queue', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        requesterEmail: 'user@example.com',
        requestType: 'deletion',
        entityIds: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /governance/dsr-queue', () => {
  it('returns 200 with empty array when no requests', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/dsr-queue?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('accepts status filter', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/dsr-queue?workspaceId=ws-1&status=pending');
    expect(res.status).toBe(200);
  });
});

describe('PATCH /governance/dsr-queue/:id/status', () => {
  it('returns 200 on valid status transition', async () => {
    const app = buildApp([]);
    const res = await app.request('/governance/dsr-queue/req-1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status value', async () => {
    const app = buildApp();
    const res = await app.request('/governance/dsr-queue/req-1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'invalid_status' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
