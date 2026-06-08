import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'federation-manager' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type FederationRelationshipType = 'parent_child' | 'sibling' | 'partner';

export type FederatedPermissions = {
  entityTypePattern: string;
  canRead: boolean;
  canWrite: boolean;
};

export type FederatedRelationship = {
  id: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  relationshipType: FederationRelationshipType;
  createdByUserId: string;
  trustedAt: Date;
  permissions: FederatedPermissions[];
};

export type FederatedEntity = {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
  sourceWorkspaceId: string;
  confidence: number;
};

export type FederatedQueryResult = {
  entities: FederatedEntity[];
  queriedWorkspaces: string[];
  totalTokensEstimate: number;
  truncated: boolean;
  permissionDenied: string[];
};

export type FederationAccessAudit = {
  queryId: string;
  sourceWorkspaceId: string;
  queriedWorkspaces: string[];
  entityCount: number;
  timestamp: Date;
};

/**
 * Register a federated trust relationship between two workspaces.
 * @param sql - SQL function
 * @param sourceWorkspaceId - Workspace initiating the federation
 * @param targetWorkspaceId - Workspace being federated with
 * @param relationshipType - Type of relationship
 * @param permissions - Per-entity-type access grants
 * @param createdByUserId - User establishing the relationship
 */
export async function registerFederatedWorkspace(
  sql: SqlFn,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  relationshipType: FederationRelationshipType,
  permissions: FederatedPermissions[],
  createdByUserId: string,
): Promise<Result<FederatedRelationship, Error>> {
  try {
    const rows = await sql`
      INSERT INTO federated_relationships
        (source_workspace_id, target_workspace_id, relationship_type, created_by_user_id, trusted_at)
      VALUES (
        ${sourceWorkspaceId}, ${targetWorkspaceId}, ${relationshipType},
        ${createdByUserId}, NOW()
      )
      ON CONFLICT (source_workspace_id, target_workspace_id)
        DO UPDATE SET relationship_type = EXCLUDED.relationship_type, trusted_at = NOW()
      RETURNING id, source_workspace_id, target_workspace_id, relationship_type, created_by_user_id, trusted_at
    ` as unknown as Array<{
      id: string;
      source_workspace_id: string;
      target_workspace_id: string;
      relationship_type: FederationRelationshipType;
      created_by_user_id: string;
      trusted_at: string;
    }>;

    const rel = rows[0];
    if (!rel) return err(new Error('Insert returned no row'));

    if (permissions.length > 0) {
      for (const perm of permissions) {
        await sql`
          INSERT INTO federation_permissions
            (relationship_id, entity_type_pattern, can_read, can_write)
          VALUES (${rel.id}, ${perm.entityTypePattern}, ${perm.canRead}, ${perm.canWrite})
          ON CONFLICT (relationship_id, entity_type_pattern)
            DO UPDATE SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write
        `;
      }
    }

    log.info('Federated workspace registered', { sourceWorkspaceId, targetWorkspaceId, relationshipType });

    return ok({
      id: rel.id,
      sourceWorkspaceId: rel.source_workspace_id,
      targetWorkspaceId: rel.target_workspace_id,
      relationshipType: rel.relationship_type,
      createdByUserId: rel.created_by_user_id,
      trustedAt: new Date(rel.trusted_at),
      permissions,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get all federated relationships for a workspace.
 * @param sql - SQL function
 * @param workspaceId - Source workspace
 */
export async function getFederatedRelationships(
  sql: SqlFn,
  workspaceId: string,
): Promise<Result<FederatedRelationship[], Error>> {
  try {
    const rows = await sql`
      SELECT r.id, r.source_workspace_id, r.target_workspace_id,
             r.relationship_type, r.created_by_user_id, r.trusted_at,
             p.entity_type_pattern, p.can_read, p.can_write
      FROM federated_relationships r
      LEFT JOIN federation_permissions p ON p.relationship_id = r.id
      WHERE r.source_workspace_id = ${workspaceId}
      ORDER BY r.trusted_at DESC
    ` as unknown as Array<{
      id: string;
      source_workspace_id: string;
      target_workspace_id: string;
      relationship_type: FederationRelationshipType;
      created_by_user_id: string;
      trusted_at: string;
      entity_type_pattern: string | null;
      can_read: boolean | null;
      can_write: boolean | null;
    }>;

    const byId = new Map<string, FederatedRelationship>();
    for (const row of rows) {
      if (!byId.has(row.id)) {
        byId.set(row.id, {
          id: row.id,
          sourceWorkspaceId: row.source_workspace_id,
          targetWorkspaceId: row.target_workspace_id,
          relationshipType: row.relationship_type,
          createdByUserId: row.created_by_user_id,
          trustedAt: new Date(row.trusted_at),
          permissions: [],
        });
      }
      if (row.entity_type_pattern !== null) {
        byId.get(row.id)!.permissions.push({
          entityTypePattern: row.entity_type_pattern,
          canRead: row.can_read ?? false,
          canWrite: row.can_write ?? false,
        });
      }
    }

    return ok(Array.from(byId.values()));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Check whether a query from sourceWorkspaceId can read a given entity type in targetWorkspaceId.
 * @param permissions - Permissions for the relationship
 * @param entityType - Entity type to check
 */
export function checkFederatedPermission(
  permissions: FederatedPermissions[],
  entityType: string,
): boolean {
  if (permissions.length === 0) return false;

  for (const perm of permissions) {
    const pattern = perm.entityTypePattern;
    if (!perm.canRead) continue;
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (entityType.startsWith(prefix)) return true;
    } else if (pattern === entityType) {
      return true;
    }
  }
  return false;
}

/**
 * Query context across federated workspaces with permission enforcement.
 * @param sql - SQL function
 * @param query - Query string
 * @param sourceWorkspaceId - Originating workspace
 * @param allowedTargetWorkspaces - Explicit list of target workspace IDs to query
 * @param maxTokenBudget - Max tokens to include in merged result
 */
export async function queryFederatedContext(
  sql: SqlFn,
  query: string,
  sourceWorkspaceId: string,
  allowedTargetWorkspaces: string[],
  maxTokenBudget = 2000,
): Promise<Result<FederatedQueryResult, Error>> {
  try {
    const relationshipsResult = await getFederatedRelationships(sql, sourceWorkspaceId);
    if (relationshipsResult.isErr()) return err(relationshipsResult.error);

    const relationships = relationshipsResult.value;
    const permissionDenied: string[] = [];
    const authorizedTargets: Array<{ workspaceId: string; permissions: FederatedPermissions[] }> = [];

    for (const targetId of allowedTargetWorkspaces) {
      const rel = relationships.find(r => r.targetWorkspaceId === targetId);
      if (!rel) {
        permissionDenied.push(targetId);
        continue;
      }
      authorizedTargets.push({ workspaceId: targetId, permissions: rel.permissions });
    }

    const entityRows = await sql`
      SELECT se.id, se.type, se.label, se.attributes, se.workspace_id AS source_workspace_id
      FROM semantic_entities se
      WHERE se.workspace_id = ANY(${authorizedTargets.map(t => t.workspaceId)})
        AND (se.label ILIKE ${'%' + query.slice(0, 50) + '%'} OR se.type ILIKE ${'%' + query.slice(0, 20) + '%'})
      ORDER BY se.last_modified DESC
      LIMIT 100
    ` as unknown as Array<{
      id: string;
      type: string;
      label: string;
      attributes: Record<string, unknown>;
      source_workspace_id: string;
    }>;

    const allEntities: FederatedEntity[] = [];
    let tokenCount = 0;
    let truncated = false;

    for (const row of entityRows) {
      const target = authorizedTargets.find(t => t.workspaceId === row.source_workspace_id);
      if (!target) continue;
      if (!checkFederatedPermission(target.permissions, row.type)) {
        continue;
      }

      const entityTokens = Math.ceil(JSON.stringify(row).length / 4);
      if (tokenCount + entityTokens > maxTokenBudget) {
        truncated = true;
        break;
      }

      allEntities.push({
        id: row.id,
        type: row.type,
        label: row.label,
        attributes: row.attributes,
        sourceWorkspaceId: row.source_workspace_id,
        confidence: 0.8,
      });
      tokenCount += entityTokens;
    }

    const queriedWorkspaces = [...new Set(allEntities.map(e => e.sourceWorkspaceId))];

    return ok({
      entities: allEntities,
      queriedWorkspaces,
      totalTokensEstimate: tokenCount,
      truncated,
      permissionDenied,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Merge federated results from multiple workspace queries, applying deduplication and token budget.
 * @param results - Array of entity lists from different workspaces
 * @param maxTokenBudget - Token ceiling for merged result
 */
export function mergeFederatedResults(
  results: FederatedEntity[][],
  maxTokenBudget = 2000,
): { entities: FederatedEntity[]; tokenCount: number; truncated: boolean } {
  const seen = new Set<string>();
  const merged: FederatedEntity[] = [];
  let tokenCount = 0;
  let truncated = false;

  for (const batch of results) {
    for (const entity of batch) {
      // Deduplicate by id across workspaces
      const dedupeKey = `${entity.type}:${entity.label.toLowerCase().trim()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const entityTokens = Math.ceil(JSON.stringify(entity).length / 4);
      if (tokenCount + entityTokens > maxTokenBudget) {
        truncated = true;
        break;
      }

      merged.push(entity);
      tokenCount += entityTokens;
    }
    if (truncated) break;
  }

  return { entities: merged, tokenCount, truncated };
}

/**
 * Log a federated access event to the audit table.
 * @param sql - SQL function
 * @param queryId - Unique query identifier
 * @param sourceWorkspaceId - Originating workspace
 * @param queriedWorkspaces - Workspaces that were queried
 * @param entityCount - Number of entities returned
 */
export async function auditFederatedAccess(
  sql: SqlFn,
  queryId: string,
  sourceWorkspaceId: string,
  queriedWorkspaces: string[],
  entityCount: number,
): Promise<Result<void, Error>> {
  try {
    await sql`
      INSERT INTO federation_access_audit
        (query_id, source_workspace_id, queried_workspaces, entity_count, accessed_at)
      VALUES (
        ${queryId}, ${sourceWorkspaceId},
        ${JSON.stringify(queriedWorkspaces)}, ${entityCount}, NOW()
      )
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get federation access audit log for a workspace.
 * @param sql - SQL function
 * @param workspaceId - Workspace to query
 * @param limit - Max rows to return
 */
export async function getFederationAuditLog(
  sql: SqlFn,
  workspaceId: string,
  limit = 50,
): Promise<Result<FederationAccessAudit[], Error>> {
  try {
    const rows = await sql`
      SELECT query_id, source_workspace_id, queried_workspaces, entity_count, accessed_at
      FROM federation_access_audit
      WHERE source_workspace_id = ${workspaceId}
      ORDER BY accessed_at DESC
      LIMIT ${limit}
    ` as unknown as Array<{
      query_id: string;
      source_workspace_id: string;
      queried_workspaces: string;
      entity_count: number;
      accessed_at: string;
    }>;

    return ok(rows.map(r => ({
      queryId: r.query_id,
      sourceWorkspaceId: r.source_workspace_id,
      queriedWorkspaces: JSON.parse(r.queried_workspaces) as string[],
      entityCount: r.entity_count,
      timestamp: new Date(r.accessed_at),
    })));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Revoke a federated relationship.
 * @param sql - SQL function
 * @param sourceWorkspaceId - Source workspace
 * @param targetWorkspaceId - Target workspace to revoke
 */
export async function revokeFederatedWorkspace(
  sql: SqlFn,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
): Promise<Result<void, Error>> {
  try {
    await sql`
      DELETE FROM federated_relationships
      WHERE source_workspace_id = ${sourceWorkspaceId}
        AND target_workspace_id = ${targetWorkspaceId}
    `;
    log.info('Federation revoked', { sourceWorkspaceId, targetWorkspaceId });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
