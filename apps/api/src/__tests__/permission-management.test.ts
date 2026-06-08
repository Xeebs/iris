import { describe, it, expect, vi } from 'vitest';
import { makePermissionRouter } from '../routes/permission-management.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/permission-manager', async () => {
  const actual = await vi.importActual('@iris/semantic-core/permission-manager') as typeof import('@iris/semantic-core/permission-manager');
  const { ok, err } = await import('neverthrow');

  class MockPermissionManager {
    definePermission = vi.fn().mockResolvedValue(ok({ id: 'p1', name: 'read:entities', resource: 'entities', action: 'read', conditions: null, description: 'test' }));
    grantPermission = vi.fn().mockResolvedValue(ok(undefined));
    revokePermission = vi.fn().mockResolvedValue(ok(undefined));
    listRolePermissions = vi.fn().mockResolvedValue(ok([
      { roleId: 'role-1', permissionId: 'read:entities', permissionName: 'read:entities', grantedAt: new Date(), grantedBy: 'admin' },
    ]));
    evaluateUserPermission = vi.fn().mockResolvedValue(ok({ granted: true, reason: 'direct match', matchedPermission: 'read:entities' }));
    getAuditTrail = vi.fn().mockResolvedValue(ok([
      { id: 'a1', roleId: 'role-1', permissionName: 'read:entities', action: 'granted', actor: 'admin', occurredAt: new Date(), context: null },
    ]));
    applyRoleTemplate = vi.fn().mockResolvedValue(ok(3));
  }

  return { ...actual, PermissionManager: MockPermissionManager };
});

function makeApp() {
  const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
  return makePermissionRouter(sql);
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'content-type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('GET /permissions', () => {
  it('returns list of permissions', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
  });
});

describe('POST /permissions', () => {
  it('creates a permission', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/', {
      method: 'POST',
      body: JSON.stringify({ name: 'read:entities', description: 'Can read entities' }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('read:entities');
  });

  it('returns 400 for missing name', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/', {
      method: 'POST',
      body: JSON.stringify({ description: 'no name' }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid body', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/', { method: 'POST', body: 'not-json' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /permissions/templates', () => {
  it('returns all role templates', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/templates'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((t: { name: string }) => t.name === 'admin')).toBe(true);
    expect(body.data.some((t: { name: string }) => t.name === 'viewer')).toBe(true);
  });
});

describe('POST /permissions/evaluate', () => {
  it('evaluates user permission', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/evaluate', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', permissionName: 'read:entities' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.granted).toBe(true);
  });

  it('returns 400 for missing userId', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/evaluate', {
      method: 'POST',
      body: JSON.stringify({ permissionName: 'read:entities' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /permissions/roles/:roleId', () => {
  it('lists role permissions', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/roles/role-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].permissionName).toBe('read:entities');
  });
});

describe('POST /permissions/roles/:roleId/grant', () => {
  it('grants a permission', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/roles/role-1/grant', {
      method: 'POST',
      body: JSON.stringify({ permissionName: 'read:entities', actor: 'admin' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.granted).toBe(true);
    expect(body.data.roleId).toBe('role-1');
  });

  it('returns 400 for missing permissionName', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/roles/role-1/grant', {
      method: 'POST',
      body: JSON.stringify({ actor: 'admin' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('POST /permissions/roles/:roleId/revoke', () => {
  it('revokes a permission', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/roles/role-1/revoke', {
      method: 'POST',
      body: JSON.stringify({ permissionName: 'read:entities', actor: 'admin' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revoked).toBe(true);
  });
});

describe('POST /permissions/roles/:roleId/apply-template', () => {
  it('applies viewer template', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/roles/role-1/apply-template', {
      method: 'POST',
      body: JSON.stringify({ templateName: 'viewer', actor: 'admin' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.applied).toBe(true);
    expect(body.data.permissionsGranted).toBe(3);
  });

  it('returns 400 for invalid template name', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/roles/role-1/apply-template', {
      method: 'POST',
      body: JSON.stringify({ templateName: 'superadmin', actor: 'admin' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /permissions/roles/:roleId/audit', () => {
  it('returns audit trail', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/roles/role-1/audit'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].action).toBe('granted');
  });
});
