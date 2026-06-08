import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'permission-manager' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionAction = 'read' | 'write' | 'admin' | 'delete';
export type PermissionResource = 'entities' | 'connectors' | 'queries' | 'metrics' | 'workspaces' | 'users';

export type Permission = {
  id: string;
  name: string;
  resource: PermissionResource;
  action: PermissionAction;
  /** Optional context filter, e.g. { connectorId: 'hubspot' } */
  conditions: Record<string, string> | null;
  description: string;
};

export type RolePermission = {
  roleId: string;
  permissionId: string;
  permissionName: string;
  grantedAt: Date;
  grantedBy: string;
};

export type PermissionAuditEntry = {
  id: string;
  roleId: string;
  permissionName: string;
  action: 'granted' | 'revoked';
  actor: string;
  occurredAt: Date;
  context: Record<string, string> | null;
};

export type PermissionEvaluation = {
  granted: boolean;
  reason: string;
  matchedPermission: string | null;
};

// ─── Built-in role templates ──────────────────────────────────────────────────

export const ROLE_TEMPLATES: Record<string, string[]> = {
  viewer: ['read:entities', 'read:metrics', 'read:queries'],
  analyst: ['read:entities', 'read:metrics', 'read:queries', 'write:queries'],
  connector_admin: ['read:entities', 'read:connectors', 'write:connectors', 'admin:connectors'],
  admin: ['read:entities', 'write:entities', 'read:connectors', 'write:connectors', 'admin:connectors', 'read:metrics', 'write:metrics', 'read:queries', 'write:queries', 'read:users', 'write:users', 'admin:workspaces'],
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a permission name string into resource and action parts.
 * Format: `action:resource` e.g. "read:entities", "admin:connectors:hubspot"
 */
export function parsePermissionName(name: string): { action: PermissionAction; resource: PermissionResource; qualifier: string | null } | null {
  const parts = name.split(':');
  if (parts.length < 2) return null;
  const action = parts[0] as PermissionAction;
  const resource = parts[1] as PermissionResource;
  const qualifier = parts[2] ?? null;
  const validActions: PermissionAction[] = ['read', 'write', 'admin', 'delete'];
  const validResources: PermissionResource[] = ['entities', 'connectors', 'queries', 'metrics', 'workspaces', 'users'];
  if (!validActions.includes(action) || !validResources.includes(resource)) return null;
  return { action, resource, qualifier };
}

/**
 * Check if a user permission set satisfies the requested permission.
 * Supports wildcard "admin:<resource>" granting read+write+admin for a resource.
 */
export function evaluatePermission(
  requestedPermission: string,
  userPermissions: string[],
  context: Record<string, string> = {},
): PermissionEvaluation {
  // Direct match
  if (userPermissions.includes(requestedPermission)) {
    return { granted: true, reason: 'direct match', matchedPermission: requestedPermission };
  }

  const parsed = parsePermissionName(requestedPermission);
  if (!parsed) {
    return { granted: false, reason: 'invalid permission format', matchedPermission: null };
  }

  // Admin on a resource grants read and write
  const adminPerm = `admin:${parsed.resource}`;
  if (userPermissions.includes(adminPerm)) {
    return { granted: true, reason: `admin on ${parsed.resource} grants ${parsed.action}`, matchedPermission: adminPerm };
  }

  // Global admin grants everything
  if (userPermissions.includes('admin:workspaces')) {
    return { granted: true, reason: 'workspace admin grants all permissions', matchedPermission: 'admin:workspaces' };
  }

  return { granted: false, reason: `permission ${requestedPermission} not found in role`, matchedPermission: null };
}

/**
 * Compute the effective permission set from a list of roles and their permissions.
 * Returns a deduplicated union.
 */
export function computeEffectivePermissions(rolePermissions: Record<string, string[]>): string[] {
  const all = Object.values(rolePermissions).flat();
  return [...new Set(all)];
}

/**
 * Validate that a permission name follows the action:resource[:qualifier] format.
 */
export function isValidPermissionName(name: string): boolean {
  return parsePermissionName(name) !== null;
}

// ─── PermissionManager ────────────────────────────────────────────────────────

export class PermissionManager {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Define a new permission.
   */
  async definePermission(
    name: string,
    description: string,
    conditions: Record<string, string> | null = null,
  ): Promise<Result<Permission, Error>> {
    const parsed = parsePermissionName(name);
    if (!parsed) return err(new Error(`Invalid permission name: ${name}. Expected action:resource format.`));

    const id = randomUUID();
    try {
      const [row] = await this.sql<Permission[]>`
        INSERT INTO permissions (id, name, resource, action, conditions, description)
        VALUES (${id}, ${name}, ${parsed.resource}, ${parsed.action}, ${conditions ? JSON.stringify(conditions) : null}, ${description})
        ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, conditions = EXCLUDED.conditions
        RETURNING id, name, resource, action, conditions, description
      `;
      return ok(row!);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Grant a permission to a role.
   */
  async grantPermission(roleId: string, permissionName: string, grantedBy: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO role_permissions (role_id, permission_name, granted_by)
        VALUES (${roleId}, ${permissionName}, ${grantedBy})
        ON CONFLICT (role_id, permission_name) DO NOTHING
      `;
      await this.sql`
        INSERT INTO permission_audit (id, role_id, permission_name, action, actor)
        VALUES (${randomUUID()}, ${roleId}, ${permissionName}, 'granted', ${grantedBy})
      `;
      log.info('Permission granted', { roleId, permissionName, grantedBy });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Revoke a permission from a role.
   */
  async revokePermission(roleId: string, permissionName: string, revokedBy: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM role_permissions WHERE role_id = ${roleId} AND permission_name = ${permissionName}
      `;
      await this.sql`
        INSERT INTO permission_audit (id, role_id, permission_name, action, actor)
        VALUES (${randomUUID()}, ${roleId}, ${permissionName}, 'revoked', ${revokedBy})
      `;
      log.info('Permission revoked', { roleId, permissionName, revokedBy });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all permissions for a role.
   */
  async listRolePermissions(roleId: string): Promise<Result<RolePermission[], Error>> {
    try {
      type Row = { role_id: string; permission_name: string; granted_at: Date; granted_by: string };
      const rows = await this.sql<Row[]>`
        SELECT role_id, permission_name, granted_at, granted_by
        FROM role_permissions WHERE role_id = ${roleId} ORDER BY granted_at DESC
      `;
      return ok(rows.map((r) => ({
        roleId: r.role_id,
        permissionId: r.permission_name,
        permissionName: r.permission_name,
        grantedAt: r.granted_at,
        grantedBy: r.granted_by,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Evaluate if a user (by their role set) has a specific permission.
   */
  async evaluateUserPermission(
    userId: string,
    permissionName: string,
    context: Record<string, string> = {},
  ): Promise<Result<PermissionEvaluation, Error>> {
    try {
      type Row = { permission_name: string };
      const rows = await this.sql<Row[]>`
        SELECT DISTINCT rp.permission_name
        FROM role_permissions rp
        JOIN context_roles cr ON cr.role_id = rp.role_id
        WHERE cr.user_id = ${userId}
      `;
      const permissions = rows.map((r) => r.permission_name);
      return ok(evaluatePermission(permissionName, permissions, context));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get permission audit trail for a role.
   */
  async getAuditTrail(roleId: string, limit = 50): Promise<Result<PermissionAuditEntry[], Error>> {
    try {
      type Row = { id: string; role_id: string; permission_name: string; action: string; actor: string; occurred_at: Date; context: Record<string, string> | null };
      const rows = await this.sql<Row[]>`
        SELECT id, role_id, permission_name, action, actor, occurred_at, context
        FROM permission_audit WHERE role_id = ${roleId}
        ORDER BY occurred_at DESC LIMIT ${limit}
      `;
      return ok(rows.map((r) => ({
        id: r.id,
        roleId: r.role_id,
        permissionName: r.permission_name,
        action: r.action as 'granted' | 'revoked',
        actor: r.actor,
        occurredAt: r.occurred_at,
        context: r.context,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Apply a role template to a role (replaces all existing permissions).
   */
  async applyRoleTemplate(roleId: string, templateName: string, grantedBy: string): Promise<Result<number, Error>> {
    const permissions = ROLE_TEMPLATES[templateName];
    if (!permissions) return err(new Error(`Unknown role template: ${templateName}. Valid: ${Object.keys(ROLE_TEMPLATES).join(', ')}`));
    try {
      for (const perm of permissions) {
        await this.grantPermission(roleId, perm, grantedBy);
      }
      return ok(permissions.length);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
