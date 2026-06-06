import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'context-permissions' });

type SqlClient = ReturnType<typeof postgres>;

export type ContextRole = {
  id: string;
  workspaceId: string;
  roleName: string;
  description: string;
};

export type EntityTypePermission = {
  entityType: string;
  /** Empty array = all fields in this entity type are allowed */
  allowedFields: string[];
};

export type ContextPermissions = {
  role: ContextRole;
  permissions: EntityTypePermission[];
  /** Set of entity types this role may access; types not present are blocked entirely */
  allowedEntityTypes: Set<string>;
};

type ContextRoleRow = {
  id: string;
  workspace_id: string;
  role_name: string;
  description: string;
};

type PermissionRow = {
  entity_type: string;
  allowed_fields: string[] | null;
};

type ApiKeyRoleRow = {
  role_id: string | null;
};

/**
 * Manages role-based context access control.
 * Roles define which entity types and attribute fields an API key holder can retrieve.
 */
export class ContextPermissionService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Create or upsert a context role for a workspace.
   *
   * @param workspaceId - Workspace that owns this role
   * @param roleName    - Unique name within the workspace
   * @param description - Human-readable description
   */
  async createRole(
    workspaceId: string,
    roleName: string,
    description = '',
  ): Promise<Result<ContextRole, Error>> {
    try {
      const [row] = await this.sql<ContextRoleRow[]>`
        INSERT INTO context_roles (workspace_id, role_name, description)
        VALUES (${workspaceId}, ${roleName}, ${description})
        ON CONFLICT (workspace_id, role_name) DO UPDATE
          SET description = EXCLUDED.description
        RETURNING id, workspace_id, role_name, description
      `;
      if (!row) return err(new Error('Insert returned no row'));
      return ok({
        id: row.id,
        workspaceId: row.workspace_id,
        roleName: row.role_name,
        description: row.description,
      });
    } catch (e) {
      log.error('Failed to create context role', { error: e, workspaceId, roleName });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Set which fields of an entity type a role may access.
   * Call multiple times to cover all permitted entity types.
   *
   * @param roleId        - Role ID from createRole
   * @param entityType    - Entity type (e.g., 'contact', 'deal')
   * @param allowedFields - Attribute key names allowed; empty array = all fields
   */
  async setEntityTypePermission(
    roleId: string,
    entityType: string,
    allowedFields: string[],
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO role_entity_type_permissions (role_id, entity_type, allowed_fields)
        VALUES (${roleId}, ${entityType}, ${JSON.stringify(allowedFields)})
        ON CONFLICT (role_id, entity_type) DO UPDATE
          SET allowed_fields = EXCLUDED.allowed_fields
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to set entity type permission', { error: e, roleId, entityType });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Load full permissions for a role by its ID.
   *
   * @param roleId - Role primary key
   */
  async getPermissions(roleId: string): Promise<Result<ContextPermissions, Error>> {
    try {
      const [roleRow] = await this.sql<ContextRoleRow[]>`
        SELECT id, workspace_id, role_name, description
        FROM context_roles WHERE id = ${roleId}
      `;
      if (!roleRow) return err(new Error(`Role "${roleId}" not found`));

      const permRows = await this.sql<PermissionRow[]>`
        SELECT entity_type, allowed_fields
        FROM role_entity_type_permissions WHERE role_id = ${roleId}
      `;

      const permissions: EntityTypePermission[] = permRows.map((r) => ({
        entityType: r.entity_type,
        allowedFields: Array.isArray(r.allowed_fields) ? r.allowed_fields : [],
      }));

      return ok({
        role: {
          id: roleRow.id,
          workspaceId: roleRow.workspace_id,
          roleName: roleRow.role_name,
          description: roleRow.description,
        },
        permissions,
        allowedEntityTypes: new Set(permissions.map((p) => p.entityType)),
      });
    } catch (e) {
      log.error('Failed to get permissions', { error: e, roleId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Load full permissions for a role by name within a workspace.
   *
   * @param workspaceId - Workspace that owns the role
   * @param roleName    - Role name
   */
  async getPermissionsByName(
    workspaceId: string,
    roleName: string,
  ): Promise<Result<ContextPermissions, Error>> {
    try {
      const [roleRow] = await this.sql<ContextRoleRow[]>`
        SELECT id FROM context_roles
        WHERE workspace_id = ${workspaceId} AND role_name = ${roleName}
      `;
      if (!roleRow) {
        return err(new Error(`Role "${roleName}" not found in workspace "${workspaceId}"`));
      }
      return this.getPermissions(roleRow.id);
    } catch (e) {
      log.error('Failed to get permissions by name', { error: e, workspaceId, roleName });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Look up the role_id assigned to an API key.
   * Returns null if the key has no role (unrestricted access).
   *
   * @param keyId - mcp_api_keys.id
   */
  async getRoleIdForKey(keyId: string): Promise<Result<string | null, Error>> {
    try {
      const [row] = await this.sql<ApiKeyRoleRow[]>`
        SELECT role_id FROM mcp_api_keys WHERE id = ${keyId}
      `;
      return ok(row?.role_id ?? null);
    } catch (e) {
      log.error('Failed to look up role for API key', { error: e, keyId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

/**
 * Filter a list of SemanticEntity objects to only those the role permits.
 *
 * - Removes entities whose type is not in `permissions.allowedEntityTypes`.
 * - For remaining entities, removes attribute keys not in `allowedFields`
 *   (when `allowedFields` is empty, all attributes are kept).
 *
 * @param entities    - Entities to filter
 * @param permissions - Resolved role permissions
 */
export function filterContextByRole(
  entities: SemanticEntity[],
  permissions: ContextPermissions,
): SemanticEntity[] {
  return entities
    .filter((entity) => permissions.allowedEntityTypes.has(entity.type))
    .map((entity) => {
      const perm = permissions.permissions.find((p) => p.entityType === entity.type);
      if (!perm || perm.allowedFields.length === 0) return entity;

      const allowedSet = new Set(perm.allowedFields);
      const filteredAttributes: Record<string, SemanticEntity['attributes'][string]> = {};
      for (const [key, value] of Object.entries(entity.attributes)) {
        if (allowedSet.has(key)) filteredAttributes[key] = value;
      }
      return { ...entity, attributes: filteredAttributes };
    });
}
