import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSCIMRoutes } from '../routes/scim.js';
import * as provisioner from '@iris/semantic-core/scim-provisioner';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/scim-provisioner');

const mockProv = vi.mocked(provisioner);

function buildApp() {
  const sql = vi.fn().mockResolvedValue([]);
  const app = new Hono();
  app.route('/scim/v2', createSCIMRoutes(sql as never));
  return { app, sql };
}

const ALICE_SCIM = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: 'ext-alice',
  userName: 'alice@example.com',
  displayName: 'Alice',
  active: true,
};

const ALICE_PROVISIONED = {
  userId: 'user-abc123',
  externalUserId: 'ext-alice',
  directoryType: 'okta' as const,
  userName: 'alice@example.com',
  displayName: 'Alice',
  email: 'alice@example.com',
  active: true,
  irisRole: 'admin',
  workspaceId: 'ws-1',
  syncedAt: new Date(),
};

const SCIM_USER_RESPONSE = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  id: 'user-abc123',
  userName: 'alice@example.com',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockProv.buildSCIMError.mockImplementation((status, detail, scimType) => ({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status, detail, ...(scimType ? { scimType } : {}),
  }));
  mockProv.toSCIMUser.mockReturnValue(SCIM_USER_RESPONSE as never);
});

describe('GET /scim/v2/Users', () => {
  it('returns 400 without workspace header', async () => {
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Users');
    expect(res.status).toBe(400);
  });

  it('returns SCIM list response', async () => {
    mockProv.getFilteredUsers.mockResolvedValue(ok({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [SCIM_USER_RESPONSE as never],
    }));
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Users', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalResults: number };
    expect(body.totalResults).toBe(1);
  });
});

describe('POST /scim/v2/Users', () => {
  it('returns 400 without workspace header', async () => {
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ALICE_SCIM),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when userName is missing', async () => {
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'] }),
    });
    expect(res.status).toBe(400);
  });

  it('provisions user and returns 201', async () => {
    mockProv.provisionUser.mockResolvedValue(ok(ALICE_PROVISIONED));
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify(ALICE_SCIM),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('Location')).toContain('user-abc123');
  });

  it('returns 500 on provision failure', async () => {
    mockProv.provisionUser.mockResolvedValue(err(new Error('DB constraint')));
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify(ALICE_SCIM),
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /scim/v2/Users/:id', () => {
  it('returns 404 when user not found', async () => {
    const { app, sql } = buildApp();
    sql.mockResolvedValue([]);
    const res = await app.request('/scim/v2/Users/missing-id', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });

  it('returns user when found', async () => {
    const { app, sql } = buildApp();
    sql.mockResolvedValue([{
      user_id: 'user-abc123', external_user_id: 'ext-1', directory_type: 'okta',
      user_name: 'alice@example.com', display_name: 'Alice', email: 'alice@example.com',
      active: true, iris_role: 'admin', synced_at: new Date().toISOString(),
    }]);
    const res = await app.request('/scim/v2/Users/user-abc123', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /scim/v2/Users/:id', () => {
  it('returns 204 on successful deprovision', async () => {
    mockProv.handleDeprovision.mockResolvedValue(ok(undefined));
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Users/user-1', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(204);
  });
});

describe('GET /scim/v2/Groups', () => {
  it('returns SCIM group list', async () => {
    mockProv.getFilteredGroups.mockResolvedValue(ok({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [{ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Admins' }],
    }));
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Groups', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalResults: number };
    expect(body.totalResults).toBe(1);
  });
});

describe('POST /scim/v2/Groups', () => {
  it('returns 201 on group creation', async () => {
    mockProv.provisionGroup.mockResolvedValue(ok({ groupName: 'Admins', irisRole: 'admin', memberCount: 0 }));
    const { app } = buildApp();
    const res = await app.request('/scim/v2/Groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Admins' }),
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /scim/v2/ServiceProviderConfig', () => {
  it('returns SCIM service provider capabilities', async () => {
    const { app } = buildApp();
    const res = await app.request('/scim/v2/ServiceProviderConfig');
    expect(res.status).toBe(200);
    const body = await res.json() as { filter: { supported: boolean } };
    expect(body.filter.supported).toBe(true);
  });
});
