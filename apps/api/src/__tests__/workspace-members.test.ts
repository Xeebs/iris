import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/collaboration-manager', () => ({
  CollaborationManager: vi.fn(),
}));
vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { CollaborationManager } from '@iris/semantic-core/collaboration-manager';
import { createWorkspaceMembersRoutes } from '../routes/workspace-members.js';

const WORKSPACE = 'ws-1';
const USER_A = 'user-alice';
const USER_B = 'user-bob';

const MEMBER = {
  id: 'mem-1',
  workspaceId: WORKSPACE,
  userId: USER_A,
  role: 'viewer',
  invitedBy: 'user-admin',
  invitedAt: new Date('2026-06-01'),
  acceptedAt: null,
};

const SHARE = {
  id: 'share-1',
  workspaceId: WORKSPACE,
  resourceType: 'connector',
  resourceId: 'conn-1',
  sharedWithUserId: USER_B,
  permission: 'read',
  grantedBy: USER_A,
  grantedAt: new Date('2026-06-01'),
};

function okResult<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value, error: null };
}
function errResult(msg: string) {
  return { isOk: () => false, isErr: () => true, value: undefined, error: new Error(msg) };
}

let mockMgr: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockMgr = {
    listMembers: vi.fn().mockResolvedValue(okResult([MEMBER])),
    inviteUser: vi.fn().mockResolvedValue(okResult(MEMBER)),
    updateUserRole: vi.fn().mockResolvedValue(okResult({ ...MEMBER, role: 'editor' })),
    removeMember: vi.fn().mockResolvedValue(okResult(undefined)),
    shareResource: vi.fn().mockResolvedValue(okResult(SHARE)),
    revokeShare: vi.fn().mockResolvedValue(okResult(undefined)),
    checkPermission: vi.fn().mockResolvedValue(okResult(true)),
  };
  vi.mocked(CollaborationManager).mockImplementation(() => mockMgr as never);
});

function makeApp(withUserId = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', WORKSPACE);
    if (withUserId) c.set('userId', USER_A);
    await next();
  });
  app.route('/workspace', createWorkspaceMembersRoutes({} as never));
  return app;
}

function makeAppNoAuth() {
  const app = new Hono();
  app.route('/workspace', createWorkspaceMembersRoutes({} as never));
  return app;
}

describe('GET /workspace/members', () => {
  it('returns list of members', async () => {
    const res = await makeApp().request('/workspace/members');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof MEMBER[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.role).toBe('viewer');
  });

  it('returns 401 when workspace missing', async () => {
    const res = await makeAppNoAuth().request('/workspace/members');
    expect(res.status).toBe(401);
  });

  it('returns 500 on service error', async () => {
    mockMgr.listMembers!.mockResolvedValue(errResult('db error'));
    const res = await makeApp().request('/workspace/members');
    expect(res.status).toBe(500);
  });
});

describe('POST /workspace/members/invite', () => {
  it('invites a user successfully', async () => {
    const res = await makeApp(true).request('/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_B, role: 'editor' }),
    });
    expect(res.status).toBe(201);
    expect(mockMgr.inviteUser).toHaveBeenCalledWith(WORKSPACE, USER_B, 'editor', USER_A);
  });

  it('returns 400 when role is invalid', async () => {
    const res = await makeApp().request('/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_B, role: 'superuser' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when userId missing', async () => {
    const res = await makeApp().request('/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    mockMgr.inviteUser!.mockResolvedValue(errResult('db error'));
    const res = await makeApp().request('/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_B, role: 'viewer' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('PUT /workspace/members/:userId/role', () => {
  it('updates member role', async () => {
    const res = await makeApp().request(`/workspace/members/${USER_A}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { role: string } };
    expect(body.data.role).toBe('editor');
  });

  it('returns 404 when member not found', async () => {
    mockMgr.updateUserRole!.mockResolvedValue(errResult('not a member of workspace'));
    const res = await makeApp().request(`/workspace/members/unknown/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid role', async () => {
    const res = await makeApp().request(`/workspace/members/${USER_A}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'god' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /workspace/members/:userId', () => {
  it('removes a member', async () => {
    const res = await makeApp().request(`/workspace/members/${USER_A}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { removed: boolean } };
    expect(body.data.removed).toBe(true);
  });

  it('returns 500 on service error', async () => {
    mockMgr.removeMember!.mockResolvedValue(errResult('db error'));
    const res = await makeApp().request(`/workspace/members/${USER_A}`, { method: 'DELETE' });
    expect(res.status).toBe(500);
  });
});

describe('POST /workspace/shares', () => {
  it('creates a resource share', async () => {
    const res = await makeApp().request('/workspace/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceType: 'connector',
        resourceId: 'conn-1',
        targetUserId: USER_B,
        permission: 'read',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof SHARE };
    expect(body.data.permission).toBe('read');
  });

  it('returns 400 for invalid resource type', async () => {
    const res = await makeApp().request('/workspace/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceType: 'database',
        resourceId: 'x',
        targetUserId: USER_B,
        permission: 'read',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    mockMgr.shareResource!.mockResolvedValue(errResult('conflict'));
    const res = await makeApp().request('/workspace/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'glossary', resourceId: 'g-1', targetUserId: USER_B, permission: 'write' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /workspace/shares', () => {
  it('revokes a share', async () => {
    const res = await makeApp().request(
      `/workspace/shares?resourceType=connector&resourceId=conn-1&targetUserId=${USER_B}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { revoked: boolean } };
    expect(body.data.revoked).toBe(true);
  });

  it('returns 400 when params missing', async () => {
    const res = await makeApp().request('/workspace/shares?resourceType=connector', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});

describe('GET /workspace/permissions/check', () => {
  it('returns allowed=true for permitted action', async () => {
    const res = await makeApp(true).request('/workspace/permissions/check?action=read');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { allowed: boolean } };
    expect(body.data.allowed).toBe(true);
  });

  it('returns 400 when action missing', async () => {
    const res = await makeApp(true).request('/workspace/permissions/check');
    expect(res.status).toBe(400);
  });

  it('returns 401 when auth context missing', async () => {
    const res = await makeAppNoAuth().request('/workspace/permissions/check?action=read');
    expect(res.status).toBe(401);
  });

  it('returns allowed=false for denied action', async () => {
    mockMgr.checkPermission!.mockResolvedValue(okResult(false));
    const res = await makeApp(true).request('/workspace/permissions/check?action=delete_workspace');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { allowed: boolean } };
    expect(body.data.allowed).toBe(false);
  });
});
