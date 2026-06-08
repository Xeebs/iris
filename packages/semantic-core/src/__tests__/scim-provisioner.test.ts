import { describe, it, expect, vi } from 'vitest';
import {
  provisionUser,
  provisionGroup,
  handleDeprovision,
  getFilteredUsers,
  getFilteredGroups,
  parseSCIMFilter,
  applyUserFilter,
  toSCIMUser,
  buildSCIMError,
  type SCIMUser,
  type SCIMGroup,
  type ProvisionedUser,
} from '../scim-provisioner.js';

const WS = 'ws-test';

function makeSql(returnValue: unknown = []) {
  return vi.fn().mockResolvedValue(returnValue) as never;
}

const ALICE: SCIMUser = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: 'ext-alice',
  userName: 'alice@example.com',
  displayName: 'Alice Smith',
  emails: [{ value: 'alice@example.com', primary: true }],
  active: true,
  groups: [{ value: 'grp-1', display: 'Admins' }],
};

const ADMIN_GROUP: SCIMGroup = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
  displayName: 'Admins',
  externalId: 'grp-admins',
};

describe('provisionUser', () => {
  it('upserts a user and returns ProvisionedUser', async () => {
    const result = await provisionUser(makeSql([]), WS, ALICE, 'okta');
    expect(result.isOk()).toBe(true);
    const user = result._unsafeUnwrap();
    expect(user.userName).toBe('alice@example.com');
    expect(user.email).toBe('alice@example.com');
    expect(user.irisRole).toBe('admin');
    expect(user.active).toBe(true);
    expect(user.directoryType).toBe('okta');
  });

  it('assigns viewer role when no groups', async () => {
    const noGroups = { ...ALICE, groups: undefined };
    const result = await provisionUser(makeSql([]), WS, noGroups);
    expect(result._unsafeUnwrap().irisRole).toBe('viewer');
  });

  it('assigns editor role for groups containing "editor"', async () => {
    const editorUser = { ...ALICE, groups: [{ value: 'g1', display: 'Content Editors' }] };
    const result = await provisionUser(makeSql([]), WS, editorUser);
    expect(result._unsafeUnwrap().irisRole).toBe('editor');
  });

  it('uses displayName fallback from name.givenName + familyName', async () => {
    const user = { ...ALICE, displayName: undefined, name: { givenName: 'Bob', familyName: 'Jones' } };
    const result = await provisionUser(makeSql([]), WS, user);
    expect(result._unsafeUnwrap().displayName).toBe('Bob Jones');
  });

  it('uses userName as email fallback when no emails array', async () => {
    const user = { ...ALICE, emails: undefined };
    const result = await provisionUser(makeSql([]), WS, user);
    expect(result._unsafeUnwrap().email).toBe('alice@example.com');
  });

  it('generates deterministic userId for same externalId', async () => {
    const r1 = await provisionUser(makeSql([]), WS, ALICE);
    const r2 = await provisionUser(makeSql([]), WS, ALICE);
    expect(r1._unsafeUnwrap().userId).toBe(r2._unsafeUnwrap().userId);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('constraint')) as never;
    const result = await provisionUser(sql, WS, ALICE);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('constraint');
  });
});

describe('provisionGroup', () => {
  it('maps admin group to admin role', async () => {
    const result = await provisionGroup(makeSql([]), WS, ADMIN_GROUP);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().irisRole).toBe('admin');
  });

  it('maps viewer group to viewer role', async () => {
    const g = { ...ADMIN_GROUP, displayName: 'Read Only Viewers' };
    const result = await provisionGroup(makeSql([]), WS, g);
    expect(result._unsafeUnwrap().irisRole).toBe('viewer');
  });

  it('returns member count', async () => {
    const g = { ...ADMIN_GROUP, members: [{ value: 'u1' }, { value: 'u2' }] };
    const result = await provisionGroup(makeSql([]), WS, g);
    expect(result._unsafeUnwrap().memberCount).toBe(2);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as never;
    const result = await provisionGroup(sql, WS, ADMIN_GROUP);
    expect(result.isErr()).toBe(true);
  });
});

describe('handleDeprovision', () => {
  it('marks user inactive', async () => {
    const sql = makeSql([]);
    const result = await handleDeprovision(sql, WS, 'user-1');
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalled();
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout')) as never;
    const result = await handleDeprovision(sql, WS, 'user-1');
    expect(result.isErr()).toBe(true);
  });
});

describe('parseSCIMFilter', () => {
  it('parses eq filter', () => {
    const f = parseSCIMFilter('userName eq "alice"');
    expect(f).toEqual({ attribute: 'userName', operator: 'eq', value: 'alice' });
  });

  it('parses co filter', () => {
    const f = parseSCIMFilter('emails.value co "@example.com"');
    expect(f?.operator).toBe('co');
    expect(f?.value).toBe('@example.com');
  });

  it('parses sw filter', () => {
    const f = parseSCIMFilter('userName sw "admin"');
    expect(f?.operator).toBe('sw');
  });

  it('returns null for invalid filter', () => {
    expect(parseSCIMFilter('invalid filter syntax!')).toBeNull();
  });

  it('is case-insensitive for operator', () => {
    const f = parseSCIMFilter('userName EQ "alice"');
    expect(f?.operator).toBe('eq');
  });
});

describe('applyUserFilter', () => {
  const users: ProvisionedUser[] = [
    { userId: 'u1', externalUserId: 'ext-1', directoryType: 'okta', userName: 'alice@example.com', displayName: 'Alice', email: 'alice@example.com', active: true, irisRole: 'admin', workspaceId: WS, syncedAt: new Date() },
    { userId: 'u2', externalUserId: 'ext-2', directoryType: 'okta', userName: 'bob@other.com', displayName: 'Bob', email: 'bob@other.com', active: false, irisRole: 'viewer', workspaceId: WS, syncedAt: new Date() },
  ];

  it('filters by eq userName', () => {
    const result = applyUserFilter(users, { attribute: 'userName', operator: 'eq', value: 'alice@example.com' });
    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe('u1');
  });

  it('filters by co email', () => {
    const result = applyUserFilter(users, { attribute: 'email', operator: 'co', value: 'example' });
    expect(result).toHaveLength(1);
  });

  it('returns all when filter is null', () => {
    expect(applyUserFilter(users, null)).toHaveLength(2);
  });
});

describe('getFilteredUsers', () => {
  const dbRows = [{
    user_id: 'u1', external_user_id: 'ext-1', directory_type: 'okta',
    user_name: 'alice@example.com', display_name: 'Alice', email: 'alice@example.com',
    active: true, iris_role: 'admin', synced_at: new Date().toISOString(),
  }];

  it('returns SCIM list response', async () => {
    const result = await getFilteredUsers(makeSql(dbRows), WS);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.totalResults).toBe(1);
    expect(list.Resources[0]?.userName).toBe('alice@example.com');
    expect(list.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
  });

  it('applies filter from string', async () => {
    const result = await getFilteredUsers(makeSql(dbRows), WS, 'userName eq "bob@example.com"');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalResults).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as never;
    const result = await getFilteredUsers(sql, WS);
    expect(result.isErr()).toBe(true);
  });
});

describe('getFilteredGroups', () => {
  const dbRows = [{ group_name: 'Admins', external_group_id: 'grp-1', iris_role: 'admin', directory_type: 'okta' }];

  it('returns SCIM list response', async () => {
    const result = await getFilteredGroups(makeSql(dbRows), WS);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().Resources).toHaveLength(1);
  });

  it('filters groups by displayName', async () => {
    const result = await getFilteredGroups(makeSql(dbRows), WS, 'displayName eq "Admins"');
    expect(result._unsafeUnwrap().totalResults).toBe(1);
  });

  it('returns empty when no match', async () => {
    const result = await getFilteredGroups(makeSql(dbRows), WS, 'displayName eq "NoSuchGroup"');
    expect(result._unsafeUnwrap().totalResults).toBe(0);
  });
});

describe('toSCIMUser', () => {
  it('maps ProvisionedUser to SCIM User resource', () => {
    const user: ProvisionedUser = {
      userId: 'u1', externalUserId: 'ext-1', directoryType: 'okta',
      userName: 'alice@example.com', displayName: 'Alice', email: 'alice@example.com',
      active: true, irisRole: 'admin', workspaceId: WS, syncedAt: new Date(),
    };
    const scim = toSCIMUser(user, '/scim/v2/Users/u1');
    expect(scim.id).toBe('u1');
    expect(scim.emails?.[0]?.value).toBe('alice@example.com');
    expect(scim.meta?.location).toBe('/scim/v2/Users/u1');
  });
});

describe('buildSCIMError', () => {
  it('builds SCIM error with schemas array', () => {
    const e = buildSCIMError(404, 'Not found');
    expect(e.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(e.status).toBe(404);
    expect(e.detail).toBe('Not found');
  });

  it('includes scimType when provided', () => {
    const e = buildSCIMError(400, 'Bad value', 'invalidValue');
    expect(e.scimType).toBe('invalidValue');
  });
});
