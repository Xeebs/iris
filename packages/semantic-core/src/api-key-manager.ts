import { createHash, randomBytes } from 'node:crypto';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'api-key-manager' });

type SqlClient = ReturnType<typeof postgres>;

export type ApiKeyRecord = {
  id: string;
  workspaceId: string;
  displayName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

type ApiKeyRow = {
  id: string;
  workspace_id: string;
  display_name: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  role_id: string | null;
};

export type ValidatedKey = {
  keyId: string;
  workspaceId: string;
  roleId: string | null;
};

const KEY_PREFIX = 'iris_';
const KEY_BYTES = 32;

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generate a new random API key in the format `iris_<hex>`.
 */
export function generateRawKey(): string {
  return `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString('hex')}`;
}

/**
 * Manages MCP API keys: creation, validation, and revocation.
 * Keys are stored as SHA-256 hashes — the raw key is shown once and never stored.
 */
export class ApiKeyManager {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Create a new API key for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param displayName - Human-readable name for this key
   * @returns Raw API key (shown once) and the key record ID
   */
  async createKey(
    workspaceId: string,
    displayName: string,
  ): Promise<Result<{ rawKey: string; id: string }, Error>> {
    try {
      const rawKey = generateRawKey();
      const keyHash = hashKey(rawKey);

      const [row] = await this.sql<ApiKeyRow[]>`
        INSERT INTO mcp_api_keys (workspace_id, key_hash, display_name)
        VALUES (${workspaceId}, ${keyHash}, ${displayName})
        RETURNING id, workspace_id, display_name, created_at, last_used_at, revoked_at
      `;
      if (!row) return err(new Error('Insert returned no row'));

      log.info('API key created', { keyId: row.id, workspaceId, displayName });
      return ok({ rawKey, id: row.id });
    } catch (e) {
      log.error('Failed to create API key', { error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Validate a raw API key and return the associated workspace.
   * Updates last_used_at on success.
   *
   * @param rawKey - Raw API key from the client
   * @returns Validated key info, or error if invalid/revoked
   */
  async validateKey(rawKey: string): Promise<Result<ValidatedKey, Error>> {
    try {
      const keyHash = hashKey(rawKey);
      const [row] = await this.sql<ApiKeyRow[]>`
        SELECT id, workspace_id, display_name, created_at, last_used_at, revoked_at, role_id
        FROM mcp_api_keys
        WHERE key_hash = ${keyHash}
          AND revoked_at IS NULL
      `;

      if (!row) {
        log.warn('API key validation failed — key not found or revoked');
        return err(new Error('Invalid or revoked API key'));
      }

      await this.sql`
        UPDATE mcp_api_keys SET last_used_at = NOW() WHERE id = ${row.id}
      `;

      log.info('API key validated', { keyId: row.id, workspaceId: row.workspace_id });
      return ok({ keyId: row.id, workspaceId: row.workspace_id, roleId: row.role_id ?? null });
    } catch (e) {
      log.error('Failed to validate API key', { error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Revoke an API key by setting its revoked_at timestamp.
   *
   * @param keyId - ID of the key to revoke
   */
  async revokeKey(keyId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE mcp_api_keys SET revoked_at = NOW()
        WHERE id = ${keyId} AND revoked_at IS NULL
      `;
      log.info('API key revoked', { keyId });
      return ok(undefined);
    } catch (e) {
      log.error('Failed to revoke API key', { error: e, keyId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all active (non-revoked) API keys for a workspace.
   *
   * @param workspaceId - Tenant workspace
   */
  async listKeys(workspaceId: string): Promise<Result<ApiKeyRecord[], Error>> {
    try {
      const rows = await this.sql<ApiKeyRow[]>`
        SELECT id, workspace_id, display_name, created_at, last_used_at, revoked_at
        FROM mcp_api_keys
        WHERE workspace_id = ${workspaceId} AND revoked_at IS NULL
        ORDER BY created_at DESC
      `;
      return ok(
        rows.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          displayName: r.display_name,
          createdAt: r.created_at,
          lastUsedAt: r.last_used_at,
          revokedAt: r.revoked_at,
        })),
      );
    } catch (e) {
      log.error('Failed to list API keys', { error: e, workspaceId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
