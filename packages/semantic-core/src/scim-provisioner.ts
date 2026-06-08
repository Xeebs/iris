import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'scim-provisioner' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type DirectoryType = 'azure_ad' | 'okta' | 'google_workspace' | 'generic';

/** SCIM 2.0 User resource (RFC 7644 §4.1) */
export type SCIMUser = {
  schemas: string[];
  id?: string;
  externalId?: string;
  userName: string;
  displayName?: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: Array<{ value: string; type?: string; primary?: boolean }>;
  active?: boolean;
  groups?: Array<{ value: string; display?: string }>;
  meta?: { resourceType: string; created?: string; lastModified?: string; location?: string };
};

/** SCIM 2.0 Group resource */
export type SCIMGroup = {
  schemas: string[];
  id?: string;
  displayName: string;
  externalId?: string;
  members?: Array<{ value: string; display?: string }>;
  meta?: { resourceType: string };
};

/** Internal representation of a provisioned user. */
export type ProvisionedUser = {
  userId: string;
  externalUserId: string;
  directoryType: DirectoryType;
  userName: string;
  displayName: string;
  email: string;
  active: boolean;
  irisRole: string;
  workspaceId: string;
  syncedAt: Date;
};

/** SCIM filter expression parsed to a simple matcher. */
export type SCIMFilter = {
  attribute: string;
  operator: 'eq' | 'co' | 'sw' | 'ne' | 'gt' | 'lt';
  value: string;
};

export type SCIMListResponse<T> = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
};

export type SCIMError = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'];
  status: number;
  scimType?: string;
  detail: string;
};

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse' as const;

/** Map a directory group name to an Iris role. */
function mapGroupToRole(groupName: string): string {
  const lowerName = groupName.toLowerCase();
  if (lowerName.includes('admin')) return 'admin';
  if (lowerName.includes('editor') || lowerName.includes('write')) return 'editor';
  if (lowerName.includes('viewer') || lowerName.includes('read')) return 'viewer';
  return 'viewer';
}

/** Generate a deterministic user ID from external user info. */
function buildUserId(workspaceId: string, externalId: string, userName: string): string {
  const base = `${workspaceId}:scim:${externalId || userName}`;
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return `user-${h.toString(16).padStart(8, '0')}`;
}

/**
 * Parse a SCIM filter string into a structured filter object.
 * Supports: userName eq "value", emails.value co "@example.com"
 * @param filterStr - SCIM filter expression
 * @returns SCIMFilter or null if unparseable
 */
export function parseSCIMFilter(filterStr: string): SCIMFilter | null {
  const match = filterStr.trim().match(/^(\w[\w.]*)\s+(eq|co|sw|ne|gt|lt)\s+"([^"]*)"$/i);
  if (!match) return null;
  return {
    attribute: match[1]!,
    operator: match[2]!.toLowerCase() as SCIMFilter['operator'],
    value: match[3]!,
  };
}

/**
 * Apply a SCIM filter to a list of SCIM users (in-memory filtering).
 * @param users - List of provisioned users
 * @param filter - Parsed SCIM filter
 */
export function applyUserFilter(users: ProvisionedUser[], filter: SCIMFilter | null): ProvisionedUser[] {
  if (!filter) return users;
  return users.filter(u => {
    let fieldValue: string;
    switch (filter.attribute) {
      case 'userName': fieldValue = u.userName; break;
      case 'emails.value':
      case 'email': fieldValue = u.email; break;
      case 'active': fieldValue = String(u.active); break;
      default: return true;
    }
    const fv = filter.value.toLowerCase();
    const uv = fieldValue.toLowerCase();
    switch (filter.operator) {
      case 'eq': return uv === fv;
      case 'co': return uv.includes(fv);
      case 'sw': return uv.startsWith(fv);
      case 'ne': return uv !== fv;
      default: return true;
    }
  });
}

/**
 * Convert a ProvisionedUser to a SCIM User resource for API responses.
 */
export function toSCIMUser(user: ProvisionedUser, location: string): SCIMUser {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.userId,
    externalId: user.externalUserId,
    userName: user.userName,
    displayName: user.displayName,
    emails: [{ value: user.email, primary: true, type: 'work' }],
    active: user.active,
    meta: {
      resourceType: 'User',
      created: user.syncedAt.toISOString(),
      lastModified: user.syncedAt.toISOString(),
      location,
    },
  };
}

/**
 * Provision a user from a SCIM User resource.
 * Creates or updates the user in the workspace directory.
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param scimUser - SCIM User payload from the directory provider
 * @param directoryType - Source directory type
 * @returns ProvisionedUser on success
 */
export async function provisionUser(
  sql: SqlFn,
  workspaceId: string,
  scimUser: SCIMUser,
  directoryType: DirectoryType = 'generic',
): Promise<Result<ProvisionedUser, Error>> {
  try {
    const externalId = scimUser.externalId ?? scimUser.id ?? scimUser.userName;
    const userId = buildUserId(workspaceId, externalId, scimUser.userName);
    const primaryEmail = scimUser.emails?.find(e => e.primary)?.value ?? scimUser.emails?.[0]?.value ?? scimUser.userName;
    const nameFallback = (
      scimUser.displayName
      ?? scimUser.name?.formatted
      ?? (`${scimUser.name?.givenName ?? ''} ${scimUser.name?.familyName ?? ''}`.trim())
    );
    const displayName = nameFallback || scimUser.userName;
    const active = scimUser.active ?? true;
    const groupRole = scimUser.groups?.length
      ? mapGroupToRole(scimUser.groups[0]!.display ?? scimUser.groups[0]!.value)
      : 'viewer';

    await sql`
      INSERT INTO scim_provisioned_users
        (user_id, external_user_id, workspace_id, directory_type, user_name, display_name, email, active, iris_role, synced_at)
      VALUES (
        ${userId}, ${externalId}, ${workspaceId}, ${directoryType},
        ${scimUser.userName}, ${displayName}, ${primaryEmail},
        ${active}, ${groupRole}, NOW()
      )
      ON CONFLICT (workspace_id, external_user_id) DO UPDATE SET
        user_name    = EXCLUDED.user_name,
        display_name = EXCLUDED.display_name,
        email        = EXCLUDED.email,
        active       = EXCLUDED.active,
        iris_role    = EXCLUDED.iris_role,
        synced_at    = NOW()
    `;

    const provisioned: ProvisionedUser = {
      userId,
      externalUserId: externalId,
      directoryType,
      userName: scimUser.userName,
      displayName,
      email: primaryEmail,
      active,
      irisRole: groupRole,
      workspaceId,
      syncedAt: new Date(),
    };

    log.info('User provisioned', { workspaceId, userId, userName: scimUser.userName, directoryType });
    return ok(provisioned);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Provision a group from a SCIM Group resource, mapping it to an Iris role.
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param scimGroup - SCIM Group payload
 * @param directoryType - Source directory type
 * @returns Mapped iris role string
 */
export async function provisionGroup(
  sql: SqlFn,
  workspaceId: string,
  scimGroup: SCIMGroup,
  directoryType: DirectoryType = 'generic',
): Promise<Result<{ groupName: string; irisRole: string; memberCount: number }, Error>> {
  try {
    const irisRole = mapGroupToRole(scimGroup.displayName);
    await sql`
      INSERT INTO scim_group_mappings
        (workspace_id, group_name, external_group_id, iris_role, directory_type, synced_at)
      VALUES (
        ${workspaceId}, ${scimGroup.displayName},
        ${scimGroup.externalId ?? scimGroup.id ?? scimGroup.displayName},
        ${irisRole}, ${directoryType}, NOW()
      )
      ON CONFLICT (workspace_id, group_name) DO UPDATE SET
        iris_role    = EXCLUDED.iris_role,
        synced_at    = NOW()
    `;

    const memberCount = scimGroup.members?.length ?? 0;
    log.info('Group provisioned', { workspaceId, groupName: scimGroup.displayName, irisRole, memberCount });
    return ok({ groupName: scimGroup.displayName, irisRole, memberCount });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Deprovision a user when they are deleted from the directory.
 * Marks them inactive rather than hard-deleting for audit trail.
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param userId - Internal Iris user ID (SCIM id field)
 */
export async function handleDeprovision(
  sql: SqlFn,
  workspaceId: string,
  userId: string,
): Promise<Result<void, Error>> {
  try {
    await sql`
      UPDATE scim_provisioned_users
      SET active = FALSE, synced_at = NOW()
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `;
    log.info('User deprovisioned', { workspaceId, userId });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get a filtered list of provisioned users for a workspace (SCIM pull-based sync).
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param filterStr - Optional SCIM filter expression
 * @param startIndex - 1-based pagination start
 * @param count - Page size
 */
export async function getFilteredUsers(
  sql: SqlFn,
  workspaceId: string,
  filterStr?: string,
  startIndex = 1,
  count = 100,
): Promise<Result<SCIMListResponse<SCIMUser>, Error>> {
  try {
    const rows = await sql`
      SELECT user_id, external_user_id, directory_type, user_name, display_name,
             email, active, iris_role, synced_at
      FROM scim_provisioned_users
      WHERE workspace_id = ${workspaceId}
      ORDER BY user_name
    ` as unknown as Array<{
      user_id: string;
      external_user_id: string;
      directory_type: DirectoryType;
      user_name: string;
      display_name: string;
      email: string;
      active: boolean;
      iris_role: string;
      synced_at: string;
    }>;

    let provisioned: ProvisionedUser[] = rows.map(r => ({
      userId: r.user_id,
      externalUserId: r.external_user_id,
      directoryType: r.directory_type,
      userName: r.user_name,
      displayName: r.display_name,
      email: r.email,
      active: r.active,
      irisRole: r.iris_role,
      workspaceId,
      syncedAt: new Date(r.synced_at),
    }));

    if (filterStr) {
      const filter = parseSCIMFilter(filterStr);
      provisioned = applyUserFilter(provisioned, filter);
    }

    const total = provisioned.length;
    const page = provisioned.slice(startIndex - 1, startIndex - 1 + count);
    const scimUsers = page.map(u =>
      toSCIMUser(u, `/scim/v2/Users/${u.userId}`),
    );

    return ok({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: page.length,
      Resources: scimUsers,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get a filtered list of provisioned groups (SCIM pull).
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param filterStr - Optional SCIM filter expression
 */
export async function getFilteredGroups(
  sql: SqlFn,
  workspaceId: string,
  filterStr?: string,
): Promise<Result<SCIMListResponse<SCIMGroup>, Error>> {
  try {
    const rows = await sql`
      SELECT group_name, external_group_id, iris_role, directory_type
      FROM scim_group_mappings
      WHERE workspace_id = ${workspaceId}
      ORDER BY group_name
    ` as unknown as Array<{
      group_name: string;
      external_group_id: string;
      iris_role: string;
      directory_type: DirectoryType;
    }>;

    let groups: SCIMGroup[] = rows.map(r => ({
      schemas: [SCIM_GROUP_SCHEMA],
      id: r.external_group_id,
      displayName: r.group_name,
      externalId: r.external_group_id,
    }));

    if (filterStr) {
      const filter = parseSCIMFilter(filterStr);
      if (filter?.attribute === 'displayName') {
        groups = groups.filter(g => {
          const v = g.displayName.toLowerCase();
          const fv = filter.value.toLowerCase();
          if (filter.operator === 'eq') return v === fv;
          if (filter.operator === 'co') return v.includes(fv);
          if (filter.operator === 'sw') return v.startsWith(fv);
          return true;
        });
      }
    }

    return ok({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: groups.length,
      startIndex: 1,
      itemsPerPage: groups.length,
      Resources: groups,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Build a SCIM error response object. */
export function buildSCIMError(status: number, detail: string, scimType?: string): SCIMError {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status,
    ...(scimType ? { scimType } : {}),
    detail,
  };
}
