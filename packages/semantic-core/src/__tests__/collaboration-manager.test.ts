import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CollaborationManager,
  roleHasPermission,
  permissionsForRole,
} from '../collaboration-manager.js';
import type postgres from 'postgres';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

type SqlClient = ReturnType<typeof postgres>;

const WORKSPACE = 'ws-1';
const USER_A = 'user-alice';
const USER_B = 'user-bob';
const INVITER = 'user-admin';

function makeSql(rows: unknown[] = []): SqlClient {
  return vi.fn().mockResolvedValue(rows) as unknown as SqlClient;
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    workspace_id: WORKSPACE,
    user_id: USER_A,
    role: 'viewer',
    invited_by: INVITER,
    invited_at: new Date('2026-06-01'),
    accepted_at: null,
    ...overrides,
  };
}

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    workspace_id: WORKSPACE,
    resource_type: 'connector',
    resource_id: 'conn-1',
    shared_with_user_id: USER_B,
    permission: 'read',
    granted_by: INVITER,
    granted_at: new Date('2026-06-01'),
    ...overrides,
  };
}

// ─── Pure function tests ──────────────────────────────────────────────────────

describe('roleHasPermission', () => {
  it('admin has all permissions', () => {
    expect(roleHasPermission('admin', 'read')).toBe(true);
    expect(roleHasPermission('admin', 'write')).toBe(true);
    expect(roleHasPermission('admin', 'manage_members')).toBe(true);
    expect(roleHasPermission('admin', 'delete_workspace')).toBe(true);
  });

  it('editor can read and write but not manage members', () => {
    expect(roleHasPermission('editor', 'read')).toBe(true);
    expect(roleHasPermission('editor', 'write')).toBe(true);
    expect(roleHasPermission('editor', 'manage_members')).toBe(false);
    expect(roleHasPermission('editor', 'delete_workspace')).toBe(false);
  });

  it('viewer can only read', () => {
    expect(roleHasPermission('viewer', 'read')).toBe(true);
    expect(roleHasPermission('viewer', 'write')).toBe(false);
    expect(roleHasPermission('viewer', 'manage_members')).toBe(false);
  });

  it('returns false for unknown action', () => {
    expect(roleHasPermission('admin', 'unknown_action')).toBe(false);
  });
});

describe('permissionsForRole', () => {
  it('admin has more permissions than editor', () => {
    expect(permissionsForRole('admin').length).toBeGreaterThan(permissionsForRole('editor').length);
  });

  it('editor has more permissions than viewer', () => {
    expect(permissionsForRole('editor').length).toBeGreaterThan(permissionsForRole('viewer').length);
  });

  it('viewer only has read', () => {
    expect(permissionsForRole('viewer')).toEqual(['read']);
  });

  it('all roles include read', () => {
    expect(permissionsForRole('admin')).toContain('read');
    expect(permissionsForRole('editor')).toContain('read');
    expect(permissionsForRole('viewer')).toContain('read');
  });
});

// ─── CollaborationManager service tests ──────────────────────────────────────

describe('CollaborationManager', () => {
  let sql: SqlClient;
  let manager: CollaborationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSql([memberRow()]);
    manager = new CollaborationManager(sql);
  });

  describe('inviteUser()', () => {
    it('returns the created member on success', async () => {
      const result = await manager.inviteUser(WORKSPACE, USER_A, 'viewer', INVITER);
      expect(result.isOk()).toBe(true);
      const member = result._unsafeUnwrap();
      expect(member.userId).toBe(USER_A);
      expect(member.role).toBe('viewer');
      expect(member.invitedBy).toBe(INVITER);
    });

    it('calls SQL once (upsert)', async () => {
      await manager.inviteUser(WORKSPACE, USER_A, 'editor');
      expect(sql).toHaveBeenCalledTimes(1);
    });

    it('returns err on DB failure', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db down')) as unknown as SqlClient;
      manager = new CollaborationManager(sql);
      const result = await manager.inviteUser(WORKSPACE, USER_A, 'admin');
      expect(result.isErr()).toBe(true);
    });

    it('works without invitedBy parameter', async () => {
      const result = await manager.inviteUser(WORKSPACE, USER_A, 'viewer');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('updateUserRole()', () => {
    it('returns updated member on success', async () => {
      sql = makeSql([memberRow({ role: 'editor' })]);
      manager = new CollaborationManager(sql);
      const result = await manager.updateUserRole(WORKSPACE, USER_A, 'editor');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().role).toBe('editor');
    });

    it('returns err when user not found (empty rows)', async () => {
      sql = makeSql([]);
      manager = new CollaborationManager(sql);
      const result = await manager.updateUserRole(WORKSPACE, USER_A, 'admin');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not a member');
    });

    it('returns err on DB failure', async () => {
      sql = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as SqlClient;
      manager = new CollaborationManager(sql);
      const result = await manager.updateUserRole(WORKSPACE, USER_A, 'viewer');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('removeMember()', () => {
    it('returns ok on success', async () => {
      sql = makeSql([]);
      manager = new CollaborationManager(sql);
      const result = await manager.removeMember(WORKSPACE, USER_A);
      expect(result.isOk()).toBe(true);
    });

    it('returns err on DB failure', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as SqlClient;
      manager = new CollaborationManager(sql);
      const result = await manager.removeMember(WORKSPACE, USER_A);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listMembers()', () => {
    it('returns list of members', async () => {
      sql = makeSql([memberRow(), memberRow({ id: 'mem-2', user_id: USER_B, role: 'editor' })]);
      manager = new CollaborationManager(sql);
      const result = await manager.listMembers(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('returns empty list when no members', async () => {
      sql = makeSql([]);
      manager = new CollaborationManager(sql);
      const result = await manager.listMembers(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('maps rows correctly', async () => {
      const result = await manager.listMembers(WORKSPACE);
      const [m] = result._unsafeUnwrap();
      expect(m!.workspaceId).toBe(WORKSPACE);
      expect(m!.userId).toBe(USER_A);
      expect(m!.acceptedAt).toBeNull();
    });
  });

  describe('shareResource()', () => {
    it('returns the created share on success', async () => {
      sql = makeSql([shareRow()]);
      manager = new CollaborationManager(sql);
      const result = await manager.shareResource(WORKSPACE, 'connector', 'conn-1', USER_B, 'read', INVITER);
      expect(result.isOk()).toBe(true);
      const share = result._unsafeUnwrap();
      expect(share.resourceType).toBe('connector');
      expect(share.permission).toBe('read');
      expect(share.sharedWithUserId).toBe(USER_B);
    });

    it('returns err on DB failure', async () => {
      sql = vi.fn().mockRejectedValue(new Error('conflict')) as unknown as SqlClient;
      manager = new CollaborationManager(sql);
      const result = await manager.shareResource(WORKSPACE, 'glossary', 'gloss-1', USER_B, 'write');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('revokeShare()', () => {
    it('returns ok on success', async () => {
      sql = makeSql([]);
      manager = new CollaborationManager(sql);
      const result = await manager.revokeShare(WORKSPACE, 'metric', 'm-1', USER_B);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('checkPermission()', () => {
    it('returns true for admin doing any action', async () => {
      sql = makeSql([{ role: 'admin' }]);
      manager = new CollaborationManager(sql);
      const result = await manager.checkPermission(WORKSPACE, USER_A, 'delete_workspace');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns false for viewer trying to write', async () => {
      let callCount = 0;
      sql = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return [{ role: 'viewer' }];
        return []; // no explicit share
      }) as unknown as SqlClient;
      manager = new CollaborationManager(sql);
      const result = await manager.checkPermission(WORKSPACE, USER_A, 'write', 'connector', 'c-1');
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns false when user is not a workspace member', async () => {
      sql = makeSql([]);
      manager = new CollaborationManager(sql);
      const result = await manager.checkPermission(WORKSPACE, 'stranger', 'read');
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns true for viewer with explicit read share', async () => {
      let callCount = 0;
      sql = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return [{ role: 'viewer' }];
        return [{ permission: 'read' }];
      }) as unknown as SqlClient;
      manager = new CollaborationManager(sql);
      const result = await manager.checkPermission(WORKSPACE, USER_A, 'read', 'connector', 'c-2');
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns true for user with write share on action=write', async () => {
      let callCount = 0;
      sql = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return [{ role: 'viewer' }];
        return [{ permission: 'write' }];
      }) as unknown as SqlClient;
      manager = new CollaborationManager(sql);
      const result = await manager.checkPermission(WORKSPACE, USER_A, 'write', 'metric', 'm-1');
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns err on DB failure', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as SqlClient;
      manager = new CollaborationManager(sql);
      const result = await manager.checkPermission(WORKSPACE, USER_A, 'read');
      expect(result.isErr()).toBe(true);
    });
  });
});
