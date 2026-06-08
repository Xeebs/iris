import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePermissionName,
  evaluatePermission,
  computeEffectivePermissions,
  isValidPermissionName,
  ROLE_TEMPLATES,
  PermissionManager,
} from '../permission-manager.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── parsePermissionName ──────────────────────────────────────────────────────

describe('parsePermissionName', () => {
  it('parses read:entities', () => {
    const r = parsePermissionName('read:entities');
    expect(r).toEqual({ action: 'read', resource: 'entities', qualifier: null });
  });

  it('parses admin:connectors:hubspot with qualifier', () => {
    const r = parsePermissionName('admin:connectors:hubspot');
    expect(r).toEqual({ action: 'admin', resource: 'connectors', qualifier: 'hubspot' });
  });

  it('parses delete:users', () => {
    const r = parsePermissionName('delete:users');
    expect(r).toEqual({ action: 'delete', resource: 'users', qualifier: null });
  });

  it('returns null for missing colon', () => {
    expect(parsePermissionName('readentities')).toBeNull();
  });

  it('returns null for invalid action', () => {
    expect(parsePermissionName('execute:entities')).toBeNull();
  });

  it('returns null for invalid resource', () => {
    expect(parsePermissionName('read:invoices')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePermissionName('')).toBeNull();
  });
});

// ─── isValidPermissionName ────────────────────────────────────────────────────

describe('isValidPermissionName', () => {
  it('returns true for valid names', () => {
    expect(isValidPermissionName('read:entities')).toBe(true);
    expect(isValidPermissionName('admin:workspaces')).toBe(true);
    expect(isValidPermissionName('write:connectors')).toBe(true);
  });

  it('returns false for invalid names', () => {
    expect(isValidPermissionName('foo')).toBe(false);
    expect(isValidPermissionName('execute:entities')).toBe(false);
    expect(isValidPermissionName('')).toBe(false);
  });
});

// ─── evaluatePermission ───────────────────────────────────────────────────────

describe('evaluatePermission', () => {
  it('grants on direct match', () => {
    const result = evaluatePermission('read:entities', ['read:entities', 'write:metrics']);
    expect(result.granted).toBe(true);
    expect(result.reason).toBe('direct match');
    expect(result.matchedPermission).toBe('read:entities');
  });

  it('denies when permission is missing', () => {
    const result = evaluatePermission('write:entities', ['read:entities']);
    expect(result.granted).toBe(false);
    expect(result.matchedPermission).toBeNull();
  });

  it('grants write via admin on same resource', () => {
    const result = evaluatePermission('write:connectors', ['admin:connectors']);
    expect(result.granted).toBe(true);
    expect(result.reason).toContain('admin on connectors');
    expect(result.matchedPermission).toBe('admin:connectors');
  });

  it('grants read via admin on same resource', () => {
    const result = evaluatePermission('read:metrics', ['admin:metrics']);
    expect(result.granted).toBe(true);
  });

  it('grants everything via admin:workspaces', () => {
    const result = evaluatePermission('delete:users', ['admin:workspaces']);
    expect(result.granted).toBe(true);
    expect(result.reason).toContain('workspace admin');
    expect(result.matchedPermission).toBe('admin:workspaces');
  });

  it('returns false for malformed permission name', () => {
    const result = evaluatePermission('badformat', ['read:entities']);
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('invalid permission format');
  });

  it('does not grant admin:connectors via admin:metrics', () => {
    const result = evaluatePermission('admin:connectors', ['admin:metrics']);
    expect(result.granted).toBe(false);
  });

  it('handles empty permission list', () => {
    const result = evaluatePermission('read:entities', []);
    expect(result.granted).toBe(false);
  });
});

// ─── computeEffectivePermissions ─────────────────────────────────────────────

describe('computeEffectivePermissions', () => {
  it('merges permissions from multiple roles without duplicates', () => {
    const perms = computeEffectivePermissions({
      viewer: ['read:entities', 'read:metrics'],
      analyst: ['read:entities', 'write:queries'],
    });
    expect(perms).toContain('read:entities');
    expect(perms).toContain('read:metrics');
    expect(perms).toContain('write:queries');
    // no duplicates
    expect(perms.filter((p) => p === 'read:entities').length).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(computeEffectivePermissions({})).toEqual([]);
  });

  it('handles a single role', () => {
    const perms = computeEffectivePermissions({ admin: ['read:entities'] });
    expect(perms).toEqual(['read:entities']);
  });
});

// ─── ROLE_TEMPLATES ───────────────────────────────────────────────────────────

describe('ROLE_TEMPLATES', () => {
  it('viewer template has only read permissions', () => {
    const perms = ROLE_TEMPLATES['viewer']!;
    expect(perms.every((p) => p.startsWith('read:'))).toBe(true);
  });

  it('admin template includes admin:workspaces', () => {
    expect(ROLE_TEMPLATES['admin']).toContain('admin:workspaces');
  });

  it('analyst template includes write:queries', () => {
    expect(ROLE_TEMPLATES['analyst']).toContain('write:queries');
  });

  it('connector_admin template includes admin:connectors', () => {
    expect(ROLE_TEMPLATES['connector_admin']).toContain('admin:connectors');
  });

  it('all template permission names are valid', () => {
    for (const [, permissions] of Object.entries(ROLE_TEMPLATES)) {
      for (const perm of permissions) {
        expect(isValidPermissionName(perm), `${perm} should be valid`).toBe(true);
      }
    }
  });
});

// ─── PermissionManager ────────────────────────────────────────────────────────

function makeSql(returnVal: unknown = [{ id: 'p1', name: 'read:entities', resource: 'entities', action: 'read', conditions: null, description: 'Read entities' }]) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('PermissionManager.definePermission', () => {
  it('returns ok with permission on success', async () => {
    const sql = makeSql();
    const mgr = new PermissionManager(sql);
    const result = await mgr.definePermission('read:entities', 'Can read entities');
    expect(result.isOk()).toBe(true);
  });

  it('returns err for invalid permission name', async () => {
    const sql = makeSql();
    const mgr = new PermissionManager(sql);
    const result = await mgr.definePermission('badinput', 'Invalid');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid permission name');
  });

  it('propagates db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db down')) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.definePermission('read:entities', 'test');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('db down');
  });
});

describe('PermissionManager.grantPermission', () => {
  it('returns ok on success', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.grantPermission('role-1', 'read:entities', 'admin');
    expect(result.isOk()).toBe(true);
  });

  it('propagates db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('insert failed')) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.grantPermission('role-1', 'read:entities', 'admin');
    expect(result.isErr()).toBe(true);
  });
});

describe('PermissionManager.revokePermission', () => {
  it('returns ok on success', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.revokePermission('role-1', 'read:entities', 'admin');
    expect(result.isOk()).toBe(true);
  });
});

describe('PermissionManager.listRolePermissions', () => {
  it('returns mapped permissions', async () => {
    const sql = vi.fn().mockResolvedValue([
      { role_id: 'role-1', permission_name: 'read:entities', granted_at: new Date('2026-01-01'), granted_by: 'admin' },
    ]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.listRolePermissions('role-1');
    expect(result.isOk()).toBe(true);
    const perms = result._unsafeUnwrap();
    expect(perms).toHaveLength(1);
    expect(perms[0]!.permissionName).toBe('read:entities');
    expect(perms[0]!.roleId).toBe('role-1');
    expect(perms[0]!.grantedBy).toBe('admin');
  });

  it('returns empty array when no permissions', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.listRolePermissions('role-1');
    expect(result._unsafeUnwrap()).toEqual([]);
  });
});

describe('PermissionManager.evaluateUserPermission', () => {
  it('returns granted=true when user has permission', async () => {
    const sql = vi.fn().mockResolvedValue([
      { permission_name: 'read:entities' },
      { permission_name: 'write:metrics' },
    ]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.evaluateUserPermission('user-1', 'read:entities');
    expect(result._unsafeUnwrap().granted).toBe(true);
  });

  it('returns granted=false when user lacks permission', async () => {
    const sql = vi.fn().mockResolvedValue([{ permission_name: 'read:metrics' }]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.evaluateUserPermission('user-1', 'write:entities');
    expect(result._unsafeUnwrap().granted).toBe(false);
  });
});

describe('PermissionManager.getAuditTrail', () => {
  it('returns mapped audit entries', async () => {
    const sql = vi.fn().mockResolvedValue([
      { id: 'a1', role_id: 'role-1', permission_name: 'read:entities', action: 'granted', actor: 'admin', occurred_at: new Date('2026-01-01'), context: null },
    ]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.getAuditTrail('role-1');
    expect(result.isOk()).toBe(true);
    const entries = result._unsafeUnwrap();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('granted');
    expect(entries[0]!.permissionName).toBe('read:entities');
  });
});

describe('PermissionManager.applyRoleTemplate', () => {
  it('grants all permissions in template', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.applyRoleTemplate('role-1', 'viewer', 'admin');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(ROLE_TEMPLATES['viewer']!.length);
  });

  it('returns err for unknown template', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new PermissionManager(sql);
    const result = await mgr.applyRoleTemplate('role-1', 'superadmin', 'admin');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Unknown role template');
  });
});
