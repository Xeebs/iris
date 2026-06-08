import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { createHash } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'enterprise-sso' });

type SqlClient = ReturnType<typeof postgres>;

export type SsoProvider = 'saml' | 'oidc';
export type AttributeMapping = Record<string, string>;

export interface SsoConfiguration {
  id: string;
  workspaceId: string;
  provider: SsoProvider;
  providerName: string;
  enabled: boolean;
  metadataUrl: string | null;
  entityId: string | null;
  acsUrl: string | null;
  issuer: string | null;
  clientId: string | null;
  attributeMappings: AttributeMapping;
  createdAt: Date;
}

export interface SsoUser {
  userId: string;
  workspaceId: string;
  externalId: string;
  externalEmail: string;
  ssoProvider: string;
  syncedGroups: string[];
  lastSyncAt: Date;
}

export interface SamlAssertion {
  nameId: string;
  attributes: Record<string, string | string[]>;
  issuer: string;
  sessionIndex?: string;
}

export interface OidcClaims {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
  iss: string;
}

export interface ProvisionedUser {
  userId: string;
  email: string;
  name: string;
  groups: string[];
  isNew: boolean;
}

/**
 * Manages enterprise SSO configurations and user provisioning for SAML 2.0 and OIDC.
 */
export class EnterpriseSsoService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Create or update an SSO configuration for a workspace.
   *
   * @param workspaceId  - Workspace to configure SSO for
   * @param provider     - SSO protocol type
   * @param providerName - Display name (e.g. "Okta", "Azure AD")
   * @param config       - Protocol-specific settings
   */
  async upsertConfiguration(
    workspaceId: string,
    provider: SsoProvider,
    providerName: string,
    config: Partial<Omit<SsoConfiguration, 'id' | 'workspaceId' | 'provider' | 'providerName' | 'createdAt'>>,
    attributeMappings: AttributeMapping = {},
  ): Promise<Result<SsoConfiguration, Error>> {
    try {
      const [row] = await this.sql<{
        id: string; workspace_id: string; provider: string; provider_name: string;
        enabled: boolean; metadata_url: string | null; entity_id: string | null;
        acs_url: string | null; issuer: string | null; client_id: string | null;
        attribute_mappings_json: AttributeMapping; created_at: Date;
      }[]>`
        INSERT INTO sso_configurations
          (workspace_id, provider, provider_name, enabled, metadata_url, entity_id,
           acs_url, issuer, client_id, attribute_mappings_json)
        VALUES (
          ${workspaceId}, ${provider}, ${providerName},
          ${config.enabled ?? false},
          ${config.metadataUrl ?? null}, ${config.entityId ?? null},
          ${config.acsUrl ?? null}, ${config.issuer ?? null}, ${config.clientId ?? null},
          ${JSON.stringify(attributeMappings)}::jsonb
        )
        ON CONFLICT (workspace_id, provider) DO UPDATE SET
          provider_name          = EXCLUDED.provider_name,
          enabled                = COALESCE(${config.enabled ?? null}, sso_configurations.enabled),
          metadata_url           = COALESCE(${config.metadataUrl ?? null}, sso_configurations.metadata_url),
          entity_id              = COALESCE(${config.entityId ?? null}, sso_configurations.entity_id),
          acs_url                = COALESCE(${config.acsUrl ?? null}, sso_configurations.acs_url),
          issuer                 = COALESCE(${config.issuer ?? null}, sso_configurations.issuer),
          client_id              = COALESCE(${config.clientId ?? null}, sso_configurations.client_id),
          attribute_mappings_json = ${JSON.stringify(attributeMappings)}::jsonb,
          updated_at             = NOW()
        RETURNING *
      `;
      if (!row) return err(new Error('Upsert returned no row'));
      return ok(this.mapSsoConfig(row));
    } catch (e) {
      log.error('Failed to upsert SSO config', { workspaceId, provider, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get SSO configuration for a workspace and provider.
   *
   * @param workspaceId - Target workspace
   * @param provider    - Protocol type to look up
   */
  async getConfiguration(workspaceId: string, provider: SsoProvider): Promise<Result<SsoConfiguration | null, Error>> {
    try {
      const [row] = await this.sql<{
        id: string; workspace_id: string; provider: string; provider_name: string;
        enabled: boolean; metadata_url: string | null; entity_id: string | null;
        acs_url: string | null; issuer: string | null; client_id: string | null;
        attribute_mappings_json: AttributeMapping; created_at: Date;
      }[]>`
        SELECT * FROM sso_configurations WHERE workspace_id = ${workspaceId} AND provider = ${provider}
      `;
      if (!row) return ok(null);
      return ok(this.mapSsoConfig(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all SSO configurations for a workspace.
   *
   * @param workspaceId - Target workspace
   */
  async listConfigurations(workspaceId: string): Promise<Result<SsoConfiguration[], Error>> {
    try {
      const rows = await this.sql<{
        id: string; workspace_id: string; provider: string; provider_name: string;
        enabled: boolean; metadata_url: string | null; entity_id: string | null;
        acs_url: string | null; issuer: string | null; client_id: string | null;
        attribute_mappings_json: AttributeMapping; created_at: Date;
      }[]>`
        SELECT * FROM sso_configurations WHERE workspace_id = ${workspaceId} ORDER BY created_at
      `;
      return ok(rows.map((r) => this.mapSsoConfig(r)));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Provision (JIT-create) or update a user from a SAML assertion.
   * Maps SAML attributes to Iris user fields using the workspace's attribute_mappings.
   *
   * @param workspaceId - Workspace the user is logging into
   * @param assertion   - Parsed SAML 2.0 assertion
   * @param mappings    - Attribute-to-field mapping configuration
   */
  async provisionFromSaml(
    workspaceId: string,
    assertion: SamlAssertion,
    mappings: AttributeMapping,
  ): Promise<Result<ProvisionedUser, Error>> {
    try {
      const email = this.extractAttr(assertion.attributes, mappings['email'] ?? 'email');
      const name = this.extractAttr(assertion.attributes, mappings['name'] ?? 'displayName');
      const groupsRaw = assertion.attributes[mappings['groups'] ?? 'memberOf'];
      const groups = Array.isArray(groupsRaw) ? groupsRaw : groupsRaw ? [groupsRaw] : [];

      if (!email) return err(new Error('SAML assertion missing email attribute'));

      const userId = this.hashExternalId(`saml:${workspaceId}:${assertion.nameId}`);
      const isNew = await this.upsertSsoUser(workspaceId, userId, assertion.nameId, email, 'saml', groups);

      log.info('SAML user provisioned', { workspaceId, email, isNew });
      return ok({ userId, email, name: name ?? email, groups, isNew });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Provision (JIT-create) or update a user from OIDC claims.
   *
   * @param workspaceId - Workspace the user is logging into
   * @param claims      - Verified OIDC token claims
   */
  async provisionFromOidc(
    workspaceId: string,
    claims: OidcClaims,
  ): Promise<Result<ProvisionedUser, Error>> {
    try {
      const email = claims.email;
      if (!email) return err(new Error('OIDC claims missing email'));

      const groups = claims.groups ?? [];
      const userId = this.hashExternalId(`oidc:${workspaceId}:${claims.sub}`);
      const isNew = await this.upsertSsoUser(workspaceId, userId, claims.sub, email, 'oidc', groups);

      log.info('OIDC user provisioned', { workspaceId, email, isNew });
      return ok({ userId, email, name: claims.name ?? email, groups, isNew });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all SSO-provisioned users for a workspace.
   *
   * @param workspaceId - Target workspace
   */
  async listSsoUsers(workspaceId: string): Promise<Result<SsoUser[], Error>> {
    try {
      const rows = await this.sql<{
        user_id: string; workspace_id: string; external_id: string; external_email: string;
        sso_provider: string; synced_groups_json: string[]; last_sync_at: Date;
      }[]>`
        SELECT * FROM sso_users WHERE workspace_id = ${workspaceId} ORDER BY last_sync_at DESC
      `;
      return ok(rows.map((r) => ({
        userId: r.user_id, workspaceId: r.workspace_id, externalId: r.external_id,
        externalEmail: r.external_email, ssoProvider: r.sso_provider,
        syncedGroups: r.synced_groups_json ?? [], lastSyncAt: r.last_sync_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Validate SAML issuer against stored configuration.
   * Returns true if the assertion's issuer matches the configured entity ID.
   *
   * @param workspaceId - Workspace to check
   * @param assertion   - SAML assertion to validate
   */
  async validateSamlIssuer(workspaceId: string, assertion: SamlAssertion): Promise<boolean> {
    const configResult = await this.getConfiguration(workspaceId, 'saml');
    if (configResult.isErr() || !configResult.value) return false;
    const { entityId } = configResult.value;
    return entityId === null || assertion.issuer === entityId;
  }

  /** Deterministic hash for external identity → internal user ID */
  hashExternalId(externalKey: string): string {
    return createHash('sha256').update(externalKey).digest('hex').slice(0, 32);
  }

  private async upsertSsoUser(
    workspaceId: string,
    userId: string,
    externalId: string,
    email: string,
    provider: string,
    groups: string[],
  ): Promise<boolean> {
    const [existing] = await this.sql<{ user_id: string }[]>`
      SELECT user_id FROM sso_users WHERE workspace_id = ${workspaceId} AND external_id = ${externalId}
    `;
    await this.sql`
      INSERT INTO sso_users (user_id, workspace_id, external_id, external_email, sso_provider, synced_groups_json, last_sync_at)
      VALUES (${userId}, ${workspaceId}, ${externalId}, ${email}, ${provider}, ${JSON.stringify(groups)}::jsonb, NOW())
      ON CONFLICT (workspace_id, external_id) DO UPDATE SET
        synced_groups_json = ${JSON.stringify(groups)}::jsonb,
        external_email     = ${email},
        last_sync_at       = NOW()
    `;
    return !existing;
  }

  private extractAttr(attrs: Record<string, string | string[]>, key: string): string | null {
    const val = attrs[key];
    if (!val) return null;
    return Array.isArray(val) ? (val[0] ?? null) : val;
  }

  private mapSsoConfig(row: {
    id: string; workspace_id: string; provider: string; provider_name: string;
    enabled: boolean; metadata_url: string | null; entity_id: string | null;
    acs_url: string | null; issuer: string | null; client_id: string | null;
    attribute_mappings_json: AttributeMapping; created_at: Date;
  }): SsoConfiguration {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      provider: row.provider as SsoProvider,
      providerName: row.provider_name,
      enabled: row.enabled,
      metadataUrl: row.metadata_url,
      entityId: row.entity_id,
      acsUrl: row.acs_url,
      issuer: row.issuer,
      clientId: row.client_id,
      attributeMappings: row.attribute_mappings_json ?? {},
      createdAt: row.created_at,
    };
  }
}
