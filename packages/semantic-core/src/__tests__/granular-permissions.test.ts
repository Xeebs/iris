import { describe, it, expect, beforeEach } from 'vitest';
import { GranularPermissionManager } from '../granular-permissions.js';
import type { SemanticEntity } from '@iris/connector-sdk';

function makeEntity(type: string, id: string, attrs: Record<string, unknown>): SemanticEntity {
  return { id, type, label: id, attributes: attrs, relationships: [], lastModified: new Date().toISOString(), sourceId: id };
}

// ─── defineFieldPermission ────────────────────────────────────────────────────

describe('GranularPermissionManager.defineFieldPermission', () => {
  let mgr: GranularPermissionManager;
  beforeEach(() => { mgr = new GranularPermissionManager(); });

  it('defines a field permission', () => {
    const perm = mgr.defineFieldPermission('ws-1', 'contact', 'email', ['sales']);
    expect(perm.fieldName).toBe('email');
    expect(perm.roleIds).toContain('sales');
  });

  it('lists field permissions for workspace', () => {
    mgr.defineFieldPermission('ws-1', 'contact', 'email', ['sales']);
    mgr.defineFieldPermission('ws-1', 'contact', 'phone', ['support']);
    expect(mgr.listFieldPermissions('ws-1')).toHaveLength(2);
  });

  it('does not include other workspaces in list', () => {
    mgr.defineFieldPermission('ws-1', 'contact', 'email', ['sales']);
    mgr.defineFieldPermission('ws-2', 'contact', 'email', ['hr']);
    expect(mgr.listFieldPermissions('ws-1')).toHaveLength(1);
  });
});

// ─── checkFieldAccess ─────────────────────────────────────────────────────────

describe('GranularPermissionManager.checkFieldAccess', () => {
  let mgr: GranularPermissionManager;
  beforeEach(() => { mgr = new GranularPermissionManager(); });

  it('grants access when no restriction defined', () => {
    expect(mgr.checkFieldAccess('user-1', 'ws-1', 'contact', 'email')).toBe(true);
  });

  it('grants access when user has required role', () => {
    mgr.defineFieldPermission('ws-1', 'contact', 'email', ['sales']);
    mgr.setUserRoles('user-1', 'ws-1', ['sales', 'viewer']);
    expect(mgr.checkFieldAccess('user-1', 'ws-1', 'contact', 'email')).toBe(true);
  });

  it('denies access when user lacks required role', () => {
    mgr.defineFieldPermission('ws-1', 'contact', 'email', ['sales']);
    mgr.setUserRoles('user-1', 'ws-1', ['support']);
    expect(mgr.checkFieldAccess('user-1', 'ws-1', 'contact', 'email')).toBe(false);
  });

  it('grants access when user has one of multiple required roles', () => {
    mgr.defineFieldPermission('ws-1', 'deal', 'value', ['sales', 'finance']);
    mgr.setUserRoles('user-2', 'ws-1', ['finance']);
    expect(mgr.checkFieldAccess('user-2', 'ws-1', 'deal', 'value')).toBe(true);
  });

  it('denies access for different permission type', () => {
    mgr.defineFieldPermission('ws-1', 'contact', 'email', ['admin'], 'edit');
    mgr.setUserRoles('user-3', 'ws-1', ['viewer']);
    // edit permission exists restricting to admin, viewer should be denied
    expect(mgr.checkFieldAccess('user-3', 'ws-1', 'contact', 'email', 'edit')).toBe(false);
  });
});

// ─── defineConnectorPermission / checkConnectorAccess ────────────────────────

describe('GranularPermissionManager.checkConnectorAccess', () => {
  let mgr: GranularPermissionManager;
  beforeEach(() => { mgr = new GranularPermissionManager(); });

  it('grants access when no restriction defined', () => {
    expect(mgr.checkConnectorAccess('user-1', 'ws-1', 'salesforce')).toBe(true);
  });

  it('grants access when user has required role', () => {
    mgr.defineConnectorPermission('ws-1', 'salesforce', ['sales_admin']);
    mgr.setUserRoles('user-1', 'ws-1', ['sales_admin']);
    expect(mgr.checkConnectorAccess('user-1', 'ws-1', 'salesforce')).toBe(true);
  });

  it('denies access when user lacks role', () => {
    mgr.defineConnectorPermission('ws-1', 'salesforce', ['sales_admin']);
    mgr.setUserRoles('user-1', 'ws-1', ['viewer']);
    expect(mgr.checkConnectorAccess('user-1', 'ws-1', 'salesforce')).toBe(false);
  });

  it('lists connector permissions for workspace', () => {
    mgr.defineConnectorPermission('ws-1', 'hubspot', ['sales']);
    mgr.defineConnectorPermission('ws-1', 'salesforce', ['finance']);
    expect(mgr.listConnectorPermissions('ws-1')).toHaveLength(2);
  });
});

// ─── applyFieldMasking ────────────────────────────────────────────────────────

describe('GranularPermissionManager.applyFieldMasking', () => {
  let mgr: GranularPermissionManager;
  beforeEach(() => { mgr = new GranularPermissionManager(); });

  it('returns entity unchanged when no restrictions', () => {
    mgr.setUserRoles('user-1', 'ws-1', ['viewer']);
    const entity = makeEntity('contact', 'c1', { name: 'Alice', email: 'a@b.com', phone: '555' });
    const [masked] = mgr.applyFieldMasking([entity], 'user-1', 'ws-1');
    expect(Object.keys(masked!.attributes)).toHaveLength(3);
  });

  it('strips disallowed fields', () => {
    mgr.defineFieldPermission('ws-1', 'contact', 'email', ['admin']);
    mgr.setUserRoles('user-1', 'ws-1', ['viewer']); // viewer, not admin
    const entity = makeEntity('contact', 'c1', { name: 'Alice', email: 'a@b.com' });
    const [masked] = mgr.applyFieldMasking([entity], 'user-1', 'ws-1');
    expect(masked!.attributes).not.toHaveProperty('email');
    expect(masked!.attributes).toHaveProperty('name');
  });

  it('preserves entity id and type after masking', () => {
    mgr.defineFieldPermission('ws-1', 'deal', 'value', ['finance']);
    mgr.setUserRoles('user-2', 'ws-1', ['viewer']);
    const entity = makeEntity('deal', 'd1', { title: 'Big Deal', value: 50000 });
    const [masked] = mgr.applyFieldMasking([entity], 'user-2', 'ws-1');
    expect(masked!.id).toBe('d1');
    expect(masked!.type).toBe('deal');
  });

  it('handles multiple entities with different types', () => {
    mgr.defineFieldPermission('ws-1', 'contact', 'ssn', ['hr']);
    mgr.setUserRoles('user-3', 'ws-1', ['sales']);
    const entities = [
      makeEntity('contact', 'c1', { name: 'Alice', ssn: '000-00-0000' }),
      makeEntity('deal', 'd1', { title: 'Deal', value: 1000 }),
    ];
    const masked = mgr.applyFieldMasking(entities, 'user-3', 'ws-1');
    expect(masked[0]!.attributes).not.toHaveProperty('ssn');
    expect(masked[1]!.attributes).toHaveProperty('value');
  });
});

// ─── revokeFieldPermission ────────────────────────────────────────────────────

describe('GranularPermissionManager.revokeFieldPermission', () => {
  let mgr: GranularPermissionManager;
  beforeEach(() => { mgr = new GranularPermissionManager(); });

  it('revokes a field permission and re-opens access', () => {
    mgr.defineFieldPermission('ws-1', 'contact', 'email', ['admin']);
    mgr.setUserRoles('user-1', 'ws-1', ['viewer']);
    expect(mgr.checkFieldAccess('user-1', 'ws-1', 'contact', 'email')).toBe(false);
    mgr.revokeFieldPermission('ws-1', 'contact', 'email');
    expect(mgr.checkFieldAccess('user-1', 'ws-1', 'contact', 'email')).toBe(true);
  });

  it('returns false when permission did not exist', () => {
    expect(mgr.revokeFieldPermission('ws-1', 'contact', 'nonexistent')).toBe(false);
  });
});
