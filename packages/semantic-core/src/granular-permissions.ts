import { logger } from '@iris/core/logger';
import type { SemanticEntity } from '@iris/connector-sdk';

const log = logger.child({ service: 'granular-permissions' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionType = 'view' | 'edit' | 'delete';

export type FieldPermission = {
  permissionId: string;
  workspaceId: string;
  entityType: string;
  fieldName: string;
  permissionType: PermissionType;
  roleIds: string[];
  createdAt: Date;
};

export type ConnectorPermission = {
  permissionId: string;
  workspaceId: string;
  connectorId: string;
  roleIds: string[];
  createdAt: Date;
};

export type UserRole = {
  userId: string;
  workspaceId: string;
  roleIds: string[];
};

// ─── GranularPermissionManager ────────────────────────────────────────────────

export class GranularPermissionManager {
  private readonly fieldPermissions: Map<string, FieldPermission> = new Map();
  private readonly connectorPermissions: Map<string, ConnectorPermission> = new Map();
  private readonly userRoles: Map<string, UserRole> = new Map();

  private fieldKey(workspaceId: string, entityType: string, fieldName: string, permType: PermissionType): string {
    return `${workspaceId}:${entityType}:${fieldName}:${permType}`;
  }

  private connectorKey(workspaceId: string, connectorId: string): string {
    return `${workspaceId}:${connectorId}`;
  }

  private userKey(workspaceId: string, userId: string): string {
    return `${workspaceId}:${userId}`;
  }

  /**
   * Register a user's roles within a workspace.
   * @param userId - User identifier
   * @param workspaceId - Workspace scope
   * @param roleIds - List of role identifiers assigned to this user
   */
  setUserRoles(userId: string, workspaceId: string, roleIds: string[]): void {
    this.userRoles.set(this.userKey(workspaceId, userId), { userId, workspaceId, roleIds });
  }

  private getUserRoles(userId: string, workspaceId: string): string[] {
    return this.userRoles.get(this.userKey(workspaceId, userId))?.roleIds ?? [];
  }

  /**
   * Define a field-level permission for specific roles.
   * @param workspaceId - Workspace scope
   * @param entityType - Entity type the field belongs to
   * @param fieldName - Field to control access for
   * @param roleIds - Roles that may perform this permission type
   * @param permissionType - Type of access (view/edit/delete)
   * @returns FieldPermission
   */
  defineFieldPermission(
    workspaceId: string,
    entityType: string,
    fieldName: string,
    roleIds: string[],
    permissionType: PermissionType = 'view',
  ): FieldPermission {
    const permissionId = `fp:${workspaceId}:${entityType}:${fieldName}:${permissionType}`;
    const perm: FieldPermission = {
      permissionId,
      workspaceId,
      entityType,
      fieldName,
      permissionType,
      roleIds,
      createdAt: new Date(),
    };
    this.fieldPermissions.set(this.fieldKey(workspaceId, entityType, fieldName, permissionType), perm);
    log.debug('Field permission defined', { entityType, fieldName, permissionType, roleCount: roleIds.length });
    return perm;
  }

  /**
   * Define a connector-level permission for specific roles.
   * @param workspaceId - Workspace scope
   * @param connectorId - Connector to restrict
   * @param roleIds - Roles that may access this connector's data
   * @returns ConnectorPermission
   */
  defineConnectorPermission(workspaceId: string, connectorId: string, roleIds: string[]): ConnectorPermission {
    const permissionId = `cp:${workspaceId}:${connectorId}`;
    const perm: ConnectorPermission = {
      permissionId,
      workspaceId,
      connectorId,
      roleIds,
      createdAt: new Date(),
    };
    this.connectorPermissions.set(this.connectorKey(workspaceId, connectorId), perm);
    log.debug('Connector permission defined', { connectorId, roleCount: roleIds.length });
    return perm;
  }

  /**
   * Check if a user has access to a specific field.
   * If no permission is defined for the field, access is granted by default.
   * @param userId - User requesting access
   * @param workspaceId - Workspace scope
   * @param entityType - Entity type containing the field
   * @param fieldName - Field to check
   * @param permissionType - Type of access requested
   * @returns true if access is allowed
   */
  checkFieldAccess(
    userId: string,
    workspaceId: string,
    entityType: string,
    fieldName: string,
    permissionType: PermissionType = 'view',
  ): boolean {
    const perm = this.fieldPermissions.get(this.fieldKey(workspaceId, entityType, fieldName, permissionType));
    if (!perm) return true; // No restriction defined = open access

    const userRoles = this.getUserRoles(userId, workspaceId);
    return perm.roleIds.some((rid) => userRoles.includes(rid));
  }

  /**
   * Check if a user has access to a connector's data.
   * If no permission is defined for the connector, access is granted by default.
   * @param userId - User requesting access
   * @param workspaceId - Workspace scope
   * @param connectorId - Connector to check
   * @returns true if access is allowed
   */
  checkConnectorAccess(userId: string, workspaceId: string, connectorId: string): boolean {
    const perm = this.connectorPermissions.get(this.connectorKey(workspaceId, connectorId));
    if (!perm) return true; // No restriction = open access

    const userRoles = this.getUserRoles(userId, workspaceId);
    return perm.roleIds.some((rid) => userRoles.includes(rid));
  }

  /**
   * Strip disallowed fields from a list of entities based on the user's permissions.
   * @param entities - Entities to mask
   * @param userId - User receiving the entities
   * @param workspaceId - Workspace scope
   * @returns Entities with disallowed fields removed
   */
  applyFieldMasking(entities: SemanticEntity[], userId: string, workspaceId: string): SemanticEntity[] {
    return entities.map((entity) => {
      const maskedAttrs: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(entity.attributes)) {
        if (this.checkFieldAccess(userId, workspaceId, entity.type, field, 'view')) {
          maskedAttrs[field] = value;
        }
      }

      const maskedCount = Object.keys(entity.attributes).length - Object.keys(maskedAttrs).length;
      if (maskedCount > 0) {
        log.debug('Fields masked', { userId, entityType: entity.type, entityId: entity.id, maskedCount });
      }

      return { ...entity, attributes: maskedAttrs };
    });
  }

  /**
   * List all field permissions for a workspace.
   * @param workspaceId - Workspace scope
   */
  listFieldPermissions(workspaceId: string): FieldPermission[] {
    return Array.from(this.fieldPermissions.values()).filter((p) => p.workspaceId === workspaceId);
  }

  /**
   * List all connector permissions for a workspace.
   * @param workspaceId - Workspace scope
   */
  listConnectorPermissions(workspaceId: string): ConnectorPermission[] {
    return Array.from(this.connectorPermissions.values()).filter((p) => p.workspaceId === workspaceId);
  }

  /**
   * Revoke a field permission.
   * @param workspaceId - Workspace scope
   * @param entityType - Entity type
   * @param fieldName - Field name
   * @param permissionType - Permission type
   * @returns true if the permission existed and was removed
   */
  revokeFieldPermission(workspaceId: string, entityType: string, fieldName: string, permissionType: PermissionType = 'view'): boolean {
    return this.fieldPermissions.delete(this.fieldKey(workspaceId, entityType, fieldName, permissionType));
  }
}
