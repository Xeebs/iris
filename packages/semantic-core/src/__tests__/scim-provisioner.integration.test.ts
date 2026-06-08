import { describe, it, expect } from 'vitest';
import {
  provisionUser,
  provisionGroup,
  handleDeprovision,
  getFilteredUsers,
  type SCIMUser,
} from '../scim-provisioner.js';

/** In-memory SQL that tracks state for integration simulation. */
function buildStatefulSql() {
  const usersTable: Array<Record<string, unknown>> = [];
  const groupsTable: Array<Record<string, unknown>> = [];

  const sql = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const query = strings.join('?').trim().toLowerCase();

    if (query.startsWith('insert into scim_provisioned_users')) {
      const [userId, externalId, workspaceId, dirType, userName, displayName, email, active, irisRole] = values as string[];
      const existing = usersTable.findIndex(u => u['workspace_id'] === workspaceId && u['external_user_id'] === externalId);
      const row = { user_id: userId, external_user_id: externalId, workspace_id: workspaceId, directory_type: dirType, user_name: userName, display_name: displayName, email, active, iris_role: irisRole, synced_at: new Date().toISOString() };
      if (existing >= 0) {
        usersTable[existing] = row;
      } else {
        usersTable.push(row);
      }
      return Promise.resolve([]);
    }

    if (query.startsWith('insert into scim_group_mappings')) {
      const [workspaceId, groupName, externalId, irisRole, dirType] = values as string[];
      const existing = groupsTable.findIndex(g => g['workspace_id'] === workspaceId && g['group_name'] === groupName);
      const row = { workspace_id: workspaceId, group_name: groupName, external_group_id: externalId, iris_role: irisRole, directory_type: dirType };
      if (existing >= 0) { groupsTable[existing] = row; } else { groupsTable.push(row); }
      return Promise.resolve([]);
    }

    if (query.startsWith('update scim_provisioned_users')) {
      const [, userId] = values as [unknown, string];
      const idx = usersTable.findIndex(u => u['user_id'] === userId);
      if (idx >= 0) { usersTable[idx] = { ...usersTable[idx], active: false }; }
      return Promise.resolve([]);
    }

    if (query.startsWith('select') && query.includes('scim_provisioned_users')) {
      return Promise.resolve(usersTable);
    }

    return Promise.resolve([]);
  };

  return { sql, usersTable, groupsTable };
}

function generateUsers(count: number, directoryType: 'okta' | 'azure_ad' | 'google_workspace'): SCIMUser[] {
  return Array.from({ length: count }, (_, i) => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    externalId: `ext-${directoryType}-${i}`,
    userName: `user${i}@${directoryType}.example.com`,
    displayName: `User ${i}`,
    emails: [{ value: `user${i}@example.com`, primary: true }],
    active: i % 10 !== 0, // 10% are inactive
    groups: i % 3 === 0
      ? [{ value: 'grp-admin', display: 'Administrators' }]
      : i % 3 === 1
        ? [{ value: 'grp-editor', display: 'Editors' }]
        : [{ value: 'grp-viewer', display: 'Viewers' }],
  }));
}

describe('SCIM integration — 100 user provisioning simulation', () => {
  const { sql, usersTable } = buildStatefulSql();
  const WS = 'ws-integration';

  it('provisions 100 users across 3 directory types without error', async () => {
    const oktaUsers = generateUsers(34, 'okta');
    const azureUsers = generateUsers(33, 'azure_ad');
    const googleUsers = generateUsers(33, 'google_workspace');
    const allUsers = [...oktaUsers, ...azureUsers, ...googleUsers];

    const results = await Promise.allSettled(
      allUsers.map(u => provisionUser(sql as never, WS, u, u.externalId?.includes('okta') ? 'okta' : u.externalId?.includes('azure') ? 'azure_ad' : 'google_workspace')),
    );

    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as { isOk: () => boolean }).isOk());
    expect(succeeded.length).toBe(100);
  });

  it('assigns correct Iris roles based on directory groups', async () => {
    const adminCount = usersTable.filter(u => u['iris_role'] === 'admin').length;
    const editorCount = usersTable.filter(u => u['iris_role'] === 'editor').length;
    const viewerCount = usersTable.filter(u => u['iris_role'] === 'viewer').length;

    expect(adminCount).toBeGreaterThan(0);
    expect(editorCount).toBeGreaterThan(0);
    expect(viewerCount).toBeGreaterThan(0);
    expect(adminCount + editorCount + viewerCount).toBe(100);
  });

  it('updates user on re-provision (upsert behavior)', async () => {
    const user = generateUsers(1, 'okta')[0]!;
    const updated = { ...user, displayName: 'Updated Name' };
    await provisionUser(sql as never, WS, user, 'okta');
    await provisionUser(sql as never, WS, updated, 'okta');

    // Only one entry per workspace+externalId
    const matching = usersTable.filter(u => u['external_user_id'] === user.externalId && u['workspace_id'] === WS);
    expect(matching.length).toBe(1);
  });

  it('deactivates users on deprovision', async () => {
    const activeUsers = usersTable.filter(u => u['active'] === true && u['workspace_id'] === WS);
    const targetUser = activeUsers[0]!;
    await handleDeprovision(sql as never, WS, String(targetUser['user_id']));
    // Deactivation should complete without error
  });

  it('getFilteredUsers retrieves all provisioned users', async () => {
    const result = await getFilteredUsers(sql as never, WS);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalResults).toBeGreaterThanOrEqual(100);
  });

  it('getFilteredUsers paginates correctly', async () => {
    const page1 = await getFilteredUsers(sql as never, WS, undefined, 1, 10);
    const page2 = await getFilteredUsers(sql as never, WS, undefined, 11, 10);
    expect(page1._unsafeUnwrap().itemsPerPage).toBe(10);
    expect(page2._unsafeUnwrap().itemsPerPage).toBe(10);
  });

  it('provisions groups for all 3 role types', async () => {
    const { sql: gSql, groupsTable } = buildStatefulSql();
    await provisionGroup(gSql as never, WS, { schemas: [], displayName: 'Administrators', externalId: 'g1' });
    await provisionGroup(gSql as never, WS, { schemas: [], displayName: 'Content Editors', externalId: 'g2' });
    await provisionGroup(gSql as never, WS, { schemas: [], displayName: 'Read-Only Viewers', externalId: 'g3' });

    expect(groupsTable.find(g => g['iris_role'] === 'admin')).toBeDefined();
    expect(groupsTable.find(g => g['iris_role'] === 'editor')).toBeDefined();
    expect(groupsTable.find(g => g['iris_role'] === 'viewer')).toBeDefined();
  });
});
