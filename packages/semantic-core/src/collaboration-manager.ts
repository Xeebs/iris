import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'collaboration-manager' });

type SqlClient = ReturnType<typeof postgres>;

export type WorkspaceRole = 'admin' | 'editor' | 'viewer';
export type ResourceType = 'connector' | 'glossary' | 'metric' | 'workflow';
export type ResourcePermission = 'read' | 'write';

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  invitedBy: string | null;
  invitedAt: Date;
  acceptedAt: Date | null;
}

export interface ResourceShare {
  id: string;
  workspaceId: string;
  resourceType: ResourceType;
  resourceId: string;
  sharedWithUserId: string;
  permission: ResourcePermission;
  grantedBy: string | null;
  grantedAt: Date;
}

export interface TeamGroup {
  id: string;
  workspaceId: string;
  groupName: string;
  memberIds: string[];
  createdBy: string | null;
  createdAt: Date;
}

// RBAC permission matrix
const ROLE_PERMISSIONS: Record<WorkspaceRole, Set<string>> = {
  admin:  new Set(['read', 'write', 'manage_members', 'manage_connectors', 'delete_workspace']),
  editor: new Set(['read', 'write', 'manage_connectors']),
  viewer: new Set(['read']),
};

/**
 * Manages workspace team members, resource sharing, and permission enforcement.
 */
export class CollaborationManager {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Add a user to a workspace with the given role (idempotent — updates role if already member).
   *
   * @param workspaceId - Target workspace
   * @param userId - User to add
   * @param role - Role to assign
   * @param invitedBy - User who sent the invite
   */
  async inviteUser(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    invitedBy?: string,
  ): Promise<Result<WorkspaceMember, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
        VALUES (${workspaceId}, ${userId}, ${role}, ${invitedBy ?? null})
        ON CONFLICT (workspace_id, user_id) DO UPDATE
          SET role = EXCLUDED.role,
              invited_by = EXCLUDED.invited_by
        RETURNING *
      `;
      log.info('User invited to workspace', { workspaceId, userId, role });
      return ok(mapMemberRow(rows[0]));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to invite user', { workspaceId, userId, error: error.message });
      return err(error);
    }
  }

  /**
   * Update a workspace member's role.
   *
   * @param workspaceId - Target workspace
   * @param userId - Member to update
   * @param newRole - New role to assign
   */
  async updateUserRole(
    workspaceId: string,
    userId: string,
    newRole: WorkspaceRole,
  ): Promise<Result<WorkspaceMember, Error>> {
    try {
      const rows = await this.sql`
        UPDATE workspace_members
        SET role = ${newRole}
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
        RETURNING *
      `;
      if (rows.length === 0) {
        return err(new Error(`User ${userId} is not a member of workspace ${workspaceId}`));
      }
      log.info('Member role updated', { workspaceId, userId, newRole });
      return ok(mapMemberRow(rows[0]));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to update user role', { workspaceId, userId, error: error.message });
      return err(error);
    }
  }

  /**
   * Remove a member from a workspace.
   *
   * @param workspaceId - Target workspace
   * @param userId - Member to remove
   */
  async removeMember(workspaceId: string, userId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM workspace_members
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
      `;
      log.info('Member removed from workspace', { workspaceId, userId });
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to remove member', { workspaceId, userId, error: error.message });
      return err(error);
    }
  }

  /**
   * List all members of a workspace.
   *
   * @param workspaceId - Target workspace
   */
  async listMembers(workspaceId: string): Promise<Result<WorkspaceMember[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM workspace_members
        WHERE workspace_id = ${workspaceId}
        ORDER BY invited_at ASC
      `;
      return ok(rows.map(mapMemberRow));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to list members', { workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Grant a specific permission on a resource to a user.
   *
   * @param workspaceId - Target workspace
   * @param resourceType - Type of resource
   * @param resourceId - Resource identifier
   * @param targetUserId - User to grant access to
   * @param permission - 'read' or 'write'
   * @param grantedBy - User performing the grant
   */
  async shareResource(
    workspaceId: string,
    resourceType: ResourceType,
    resourceId: string,
    targetUserId: string,
    permission: ResourcePermission,
    grantedBy?: string,
  ): Promise<Result<ResourceShare, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO resource_shares
          (workspace_id, resource_type, resource_id, shared_with_user_id, permission, granted_by)
        VALUES
          (${workspaceId}, ${resourceType}, ${resourceId}, ${targetUserId}, ${permission}, ${grantedBy ?? null})
        ON CONFLICT (workspace_id, resource_type, resource_id, shared_with_user_id) DO UPDATE
          SET permission = EXCLUDED.permission,
              granted_by = EXCLUDED.granted_by,
              granted_at = NOW()
        RETURNING *
      `;
      log.info('Resource shared', { workspaceId, resourceType, resourceId, targetUserId, permission });
      return ok(mapShareRow(rows[0]));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to share resource', { workspaceId, resourceType, resourceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Revoke a resource share from a user.
   *
   * @param workspaceId - Target workspace
   * @param resourceType - Type of resource
   * @param resourceId - Resource identifier
   * @param targetUserId - User whose access to revoke
   */
  async revokeShare(
    workspaceId: string,
    resourceType: ResourceType,
    resourceId: string,
    targetUserId: string,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM resource_shares
        WHERE workspace_id = ${workspaceId}
          AND resource_type = ${resourceType}
          AND resource_id = ${resourceId}
          AND shared_with_user_id = ${targetUserId}
      `;
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to revoke share', { workspaceId, resourceType, resourceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Check whether a user has a specific permission on a resource.
   * Admins have all permissions; otherwise checks role + explicit share grants.
   *
   * @param workspaceId - Target workspace
   * @param userId - User to check
   * @param action - Permission action to verify
   * @param resourceType - Optional resource type for explicit grants
   * @param resourceId - Optional resource identifier for explicit grants
   */
  async checkPermission(
    workspaceId: string,
    userId: string,
    action: string,
    resourceType?: ResourceType,
    resourceId?: string,
  ): Promise<Result<boolean, Error>> {
    try {
      // Get the member's workspace role
      const memberRows = await this.sql`
        SELECT role FROM workspace_members
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
        LIMIT 1
      `;

      if (memberRows.length === 0) return ok(false);

      const role = memberRows[0]!.role as WorkspaceRole;
      const rolePerms = ROLE_PERMISSIONS[role] ?? new Set<string>();

      // Role-based permission covers it
      if (rolePerms.has(action)) return ok(true);

      // Check explicit resource share when resource context is provided
      if (resourceType && resourceId) {
        const shareRows = await this.sql`
          SELECT permission FROM resource_shares
          WHERE workspace_id = ${workspaceId}
            AND resource_type = ${resourceType}
            AND resource_id = ${resourceId}
            AND shared_with_user_id = ${userId}
          LIMIT 1
        `;
        if (shareRows.length > 0) {
          const sharePerm = shareRows[0]!.permission as ResourcePermission;
          if (action === 'read') return ok(true);
          if (action === 'write' && sharePerm === 'write') return ok(true);
        }
      }

      return ok(false);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to check permission', { workspaceId, userId, action, error: error.message });
      return err(error);
    }
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Determine whether a role has a given permission without a DB call.
 *
 * @param role - Workspace member role
 * @param action - Permission to check
 * @returns True if the role includes the permission
 */
export function roleHasPermission(role: WorkspaceRole, action: string): boolean {
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}

/**
 * Return all permissions granted to a role.
 *
 * @param role - Workspace member role
 */
export function permissionsForRole(role: WorkspaceRole): string[] {
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

interface MemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  invited_by: string | null;
  invited_at: Date;
  accepted_at: Date | null;
}

function mapMemberRow(r: unknown): WorkspaceMember {
  const row = r as MemberRow;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role as WorkspaceRole,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
  };
}

interface ShareRow {
  id: string;
  workspace_id: string;
  resource_type: string;
  resource_id: string;
  shared_with_user_id: string;
  permission: string;
  granted_by: string | null;
  granted_at: Date;
}

function mapShareRow(r: unknown): ResourceShare {
  const row = r as ShareRow;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    resourceType: row.resource_type as ResourceType,
    resourceId: row.resource_id,
    sharedWithUserId: row.shared_with_user_id,
    permission: row.permission as ResourcePermission,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  };
}
