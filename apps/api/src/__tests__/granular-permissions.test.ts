import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createGranularPermissionsRoutes } from '../routes/granular-permissions.js';

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
  app.route('/permissions', createGranularPermissionsRoutes(makeSql(sqlRows)));
  return app;
}

// ─── GET /permissions/fields ──────────────────────────────────────────────────

describe('GET /permissions/fields', () => {
  it('returns empty list when no permissions', async () => {
    const app = buildApp([]);
    const res = await app.request('/permissions/fields?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });

  it('returns field permissions', async () => {
    const row = {
      permission_id: 'fp:ws-1:contact:email:view',
      workspace_id: 'ws-1', entity_type: 'contact', field_name: 'email',
      permission_type: 'view', role_ids_json: ['sales'], created_at: new Date(),
    };
    const app = buildApp([row]);
    const res = await app.request('/permissions/fields?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ fieldName: string }> };
    expect(body.data[0]!.fieldName).toBe('email');
  });
});

// ─── POST /permissions/fields ─────────────────────────────────────────────────

describe('POST /permissions/fields', () => {
  it('creates a field permission', async () => {
    const app = buildApp([]);
    const res = await app.request('/permissions/fields', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', entityType: 'contact', fieldName: 'email', roleIds: ['admin'], permissionType: 'view' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { permissionId: string; fieldName: string } };
    expect(body.data.fieldName).toBe('email');
    expect(body.data.permissionId).toContain('email');
  });

  it('returns 400 for missing roleIds', async () => {
    const app = buildApp([]);
    const res = await app.request('/permissions/fields', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', entityType: 'contact', fieldName: 'email' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty roleIds array', async () => {
    const app = buildApp([]);
    const res = await app.request('/permissions/fields', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', entityType: 'contact', fieldName: 'email', roleIds: [] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /permissions/fields/:id ──────────────────────────────────────────

describe('DELETE /permissions/fields/:id', () => {
  it('returns 200 with revoked=true', async () => {
    const app = buildApp([]);
    const res = await app.request('/permissions/fields/fp-abc?workspaceId=ws-1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { revoked: boolean } };
    expect(body.data.revoked).toBe(true);
  });
});

// ─── GET /permissions/connectors ─────────────────────────────────────────────

describe('GET /permissions/connectors', () => {
  it('returns empty connector permissions', async () => {
    const app = buildApp([]);
    const res = await app.request('/permissions/connectors?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data).toHaveLength(0);
  });

  it('returns connector permission entries', async () => {
    const row = {
      permission_id: 'cp:ws-1:salesforce', workspace_id: 'ws-1',
      connector_id: 'salesforce', role_ids_json: ['sales_admin'], created_at: new Date(),
    };
    const app = buildApp([row]);
    const res = await app.request('/permissions/connectors?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ connectorId: string }> };
    expect(body.data[0]!.connectorId).toBe('salesforce');
  });
});

// ─── POST /permissions/connectors ────────────────────────────────────────────

describe('POST /permissions/connectors', () => {
  it('creates a connector permission', async () => {
    const app = buildApp([]);
    const res = await app.request('/permissions/connectors', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', connectorId: 'salesforce', roleIds: ['sales_admin'] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { connectorId: string } };
    expect(body.data.connectorId).toBe('salesforce');
  });

  it('returns 400 for missing connectorId', async () => {
    const app = buildApp([]);
    const res = await app.request('/permissions/connectors', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1', roleIds: ['admin'] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
