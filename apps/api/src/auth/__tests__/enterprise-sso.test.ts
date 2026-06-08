import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnterpriseSsoService } from '../enterprise-sso.js';
import type { SamlAssertion, OidcClaims } from '../enterprise-sso.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(...responses: unknown[][]) {
  let idx = 0;
  return vi.fn().mockImplementation(() => Promise.resolve(responses[idx++] ?? []));
}

const WORKSPACE = 'ws-sso';
const FAKE_CONFIG_ROW = {
  id: 'cfg-1',
  workspace_id: WORKSPACE,
  provider: 'saml',
  provider_name: 'Okta',
  enabled: true,
  metadata_url: 'https://okta.example.com/metadata',
  entity_id: 'https://okta.example.com',
  acs_url: 'https://iris.example.com/acs',
  issuer: 'https://okta.example.com',
  client_id: null,
  attribute_mappings_json: { email: 'mail', name: 'displayName', groups: 'memberOf' },
  created_at: new Date(),
};

const SAML_ASSERTION: SamlAssertion = {
  nameId: 'user@example.com',
  attributes: { mail: 'user@example.com', displayName: 'Jane Doe', memberOf: ['admin', 'sales'] },
  issuer: 'https://okta.example.com',
};

const OIDC_CLAIMS: OidcClaims = {
  sub: 'user-123',
  email: 'user@example.com',
  name: 'Jane Doe',
  groups: ['admin'],
  iss: 'https://login.microsoftonline.com/tenant-id',
};

describe('EnterpriseSsoService.upsertConfiguration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a new SAML configuration', async () => {
    const sql = makeSql([FAKE_CONFIG_ROW]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.upsertConfiguration(WORKSPACE, 'saml', 'Okta', {
      metadataUrl: 'https://okta.example.com/metadata',
      entityId: 'https://okta.example.com',
      enabled: true,
    }, { email: 'mail', name: 'displayName' });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().provider).toBe('saml');
    expect(result._unsafeUnwrap().providerName).toBe('Okta');
  });

  it('returns err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('DB fail'));
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.upsertConfiguration(WORKSPACE, 'oidc', 'Azure AD', {});
    expect(result.isErr()).toBe(true);
  });
});

describe('EnterpriseSsoService.getConfiguration', () => {
  it('returns config when found', async () => {
    const sql = makeSql([FAKE_CONFIG_ROW]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.getConfiguration(WORKSPACE, 'saml');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.providerName).toBe('Okta');
  });

  it('returns null when no config exists', async () => {
    const sql = makeSql([]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.getConfiguration(WORKSPACE, 'oidc');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('DB fail'));
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.getConfiguration(WORKSPACE, 'saml');
    expect(result.isErr()).toBe(true);
  });
});

describe('EnterpriseSsoService.listConfigurations', () => {
  it('returns all configurations for a workspace', async () => {
    const sql = makeSql([FAKE_CONFIG_ROW, { ...FAKE_CONFIG_ROW, id: 'cfg-2', provider: 'oidc', provider_name: 'Azure AD' }]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.listConfigurations(WORKSPACE);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(2);
  });

  it('returns empty array when no configurations', async () => {
    const sql = makeSql([]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.listConfigurations(WORKSPACE);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });
});

describe('EnterpriseSsoService.provisionFromSaml', () => {
  it('provisions a new user from SAML assertion', async () => {
    const sql = makeSql([], []);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.provisionFromSaml(
      WORKSPACE, SAML_ASSERTION,
      { email: 'mail', name: 'displayName', groups: 'memberOf' },
    );
    expect(result.isOk()).toBe(true);
    const user = result._unsafeUnwrap();
    expect(user.email).toBe('user@example.com');
    expect(user.name).toBe('Jane Doe');
    expect(user.groups).toEqual(['admin', 'sales']);
    expect(user.isNew).toBe(true);
  });

  it('marks user as existing when found in DB', async () => {
    const sql = makeSql([{ user_id: 'existing-user' }], []);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.provisionFromSaml(WORKSPACE, SAML_ASSERTION, { email: 'mail' });
    expect(result._unsafeUnwrap().isNew).toBe(false);
  });

  it('returns err when email attribute is missing', async () => {
    const sql = makeSql();
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const noEmail: SamlAssertion = { nameId: 'uid', attributes: { name: 'Test' }, issuer: 'https://idp.example.com' };
    const result = await svc.provisionFromSaml(WORKSPACE, noEmail, {});
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('email');
  });

  it('extracts email from mapped attribute key', async () => {
    const sql = makeSql([], []);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const assertion: SamlAssertion = {
      nameId: 'u1', attributes: { emailAddress: 'mapped@example.com' }, issuer: 'https://idp.example.com',
    };
    const result = await svc.provisionFromSaml(WORKSPACE, assertion, { email: 'emailAddress' });
    expect(result._unsafeUnwrap().email).toBe('mapped@example.com');
  });
});

describe('EnterpriseSsoService.provisionFromOidc', () => {
  it('provisions a new user from OIDC claims', async () => {
    const sql = makeSql([], []);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await svc.provisionFromOidc(WORKSPACE, OIDC_CLAIMS);
    expect(result.isOk()).toBe(true);
    const user = result._unsafeUnwrap();
    expect(user.email).toBe('user@example.com');
    expect(user.groups).toEqual(['admin']);
    expect(user.isNew).toBe(true);
  });

  it('returns err when email is missing from OIDC claims', async () => {
    const sql = makeSql();
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const noClaims: OidcClaims = { sub: 'user-123', iss: 'https://login.microsoftonline.com' };
    const result = await svc.provisionFromOidc(WORKSPACE, noClaims);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('email');
  });

  it('handles missing groups gracefully', async () => {
    const sql = makeSql([], []);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const noGroups: OidcClaims = { sub: 'u2', email: 'u2@example.com', iss: 'https://idp.example.com' };
    const result = await svc.provisionFromOidc(WORKSPACE, noGroups);
    expect(result._unsafeUnwrap().groups).toEqual([]);
  });
});

describe('EnterpriseSsoService.validateSamlIssuer', () => {
  it('returns true when assertion issuer matches stored entity ID', async () => {
    const sql = makeSql([FAKE_CONFIG_ROW]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const valid = await svc.validateSamlIssuer(WORKSPACE, SAML_ASSERTION);
    expect(valid).toBe(true);
  });

  it('returns false when assertion issuer does not match', async () => {
    const sql = makeSql([{ ...FAKE_CONFIG_ROW, entity_id: 'https://different-idp.example.com' }]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const valid = await svc.validateSamlIssuer(WORKSPACE, SAML_ASSERTION);
    expect(valid).toBe(false);
  });

  it('returns true when entity_id is null (no validation configured)', async () => {
    const sql = makeSql([{ ...FAKE_CONFIG_ROW, entity_id: null }]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const valid = await svc.validateSamlIssuer(WORKSPACE, SAML_ASSERTION);
    expect(valid).toBe(true);
  });

  it('returns false when no configuration found', async () => {
    const sql = makeSql([]);
    const svc = new EnterpriseSsoService(sql as unknown as ReturnType<typeof import('postgres').default>);
    const valid = await svc.validateSamlIssuer(WORKSPACE, SAML_ASSERTION);
    expect(valid).toBe(false);
  });
});

describe('EnterpriseSsoService.hashExternalId', () => {
  it('produces consistent hash for same input', () => {
    const svc = new EnterpriseSsoService(vi.fn() as unknown as ReturnType<typeof import('postgres').default>);
    const h1 = svc.hashExternalId('saml:ws-1:user@example.com');
    const h2 = svc.hashExternalId('saml:ws-1:user@example.com');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different inputs', () => {
    const svc = new EnterpriseSsoService(vi.fn() as unknown as ReturnType<typeof import('postgres').default>);
    expect(svc.hashExternalId('saml:ws-1:user1')).not.toBe(svc.hashExternalId('saml:ws-1:user2'));
  });

  it('produces 32-char hex string', () => {
    const svc = new EnterpriseSsoService(vi.fn() as unknown as ReturnType<typeof import('postgres').default>);
    const hash = svc.hashExternalId('test');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});
