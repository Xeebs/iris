import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { SecretVault } from '@iris/semantic-core/secret-vault';
import { AuditLogService } from '@iris/semantic-core/audit-log-service';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'api-key-management' });

type SqlClient = ReturnType<typeof postgres>;

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
  rotationScheduleDays: z.number().int().min(1).max(365).optional(),
});

/**
 * Factory for API key management routes with rotation and revocation.
 *
 * @param sql - Postgres client
 * @param masterSecret - Vault master secret for key generation
 * @returns Hono router mounted under /api-keys
 */
export function createApiKeyManagementRoutes(sql: SqlClient, masterSecret: string): Hono {
  const app = new Hono();
  const vault = new SecretVault(masterSecret);
  const auditService = new AuditLogService(
    sql as ConstructorParameters<typeof AuditLogService>[0],
  );

  /** GET /api/v1/api-keys — list workspace API keys (masked) */
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const rows = await sql`
      SELECT id, name, key_prefix, key_suffix, status, key_version,
             expires_at, rotation_schedule_days, rotated_at, revoked_at, created_at
      FROM mcp_api_keys
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
    ` as Record<string, unknown>[];

    const keys = rows.map((r) => ({
      id: r['id'],
      name: r['name'],
      maskedKey: `${r['key_prefix']}...${r['key_suffix']}`,
      status: r['status'],
      keyVersion: r['key_version'],
      expiresAt: r['expires_at'],
      rotationScheduleDays: r['rotation_schedule_days'],
      rotatedAt: r['rotated_at'],
      revokedAt: r['revoked_at'],
      createdAt: r['created_at'],
    }));

    return c.json({ data: keys });
  });

  /** POST /api/v1/api-keys — create a new API key */
  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createKeySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { name, expiresAt, rotationScheduleDays } = parsed.data;
    const { plaintext, prefix, suffix, hash } = vault.generateApiKey();

    const rows = await sql`
      INSERT INTO mcp_api_keys (
        workspace_id, name, key_prefix, key_suffix, key_hash, status,
        expires_at, rotation_schedule_days
      ) VALUES (
        ${workspaceId}, ${name}, ${prefix}, ${suffix}, ${hash}, 'active',
        ${expiresAt ?? null}, ${rotationScheduleDays ?? null}
      )
      RETURNING id, name, key_prefix, key_suffix, status, created_at
    ` as Record<string, unknown>[];

    const row = rows[0]!;

    await auditService.logAction({
      workspaceId,
      actorType: 'user',
      action: 'config_change',
      resourceType: 'api_key',
      resourceId: row['id'] as string,
      metadata: { name, action: 'created' },
    });

    log.info('API key created', { workspaceId, keyId: row['id'] });
    return c.json({
      data: {
        id: row['id'],
        name: row['name'],
        key: plaintext,
        maskedKey: `${row['key_prefix']}...${row['key_suffix']}`,
        status: row['status'],
        createdAt: row['created_at'],
      },
    }, 201);
  });

  /** POST /api/v1/api-keys/:id/rotate — rotate an API key */
  app.post('/:id/rotate', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { id } = c.req.param();

    const existing = await sql`
      SELECT id, key_hash, key_version, previous_key_hashes, status
      FROM mcp_api_keys
      WHERE id = ${id} AND workspace_id = ${workspaceId}
    ` as { id: string; key_hash: string; key_version: number; previous_key_hashes: string[]; status: string }[];

    if (existing.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
    }

    const current = existing[0]!;
    if (current.status === 'revoked') {
      return c.json({ error: { code: 'CONFLICT', message: 'Cannot rotate a revoked key' } }, 409);
    }

    const { plaintext, prefix, suffix, hash } = vault.generateApiKey();
    const gracePeriodEndsAt = vault.computeGracePeriodEnd();
    const previousHashes = [...(current.previous_key_hashes ?? []), current.key_hash];

    await sql`
      UPDATE mcp_api_keys SET
        key_prefix = ${prefix},
        key_suffix = ${suffix},
        key_hash = ${hash},
        key_version = ${current.key_version + 1},
        status = 'rotated',
        previous_key_hashes = ${JSON.stringify(previousHashes)},
        rotated_at = now(),
        grace_period_ends_at = ${gracePeriodEndsAt},
        updated_at = now()
      WHERE id = ${id}
    `;

    await auditService.logAction({
      workspaceId,
      actorType: 'user',
      action: 'config_change',
      resourceType: 'api_key',
      resourceId: id,
      metadata: { action: 'rotated', newVersion: current.key_version + 1, gracePeriodEndsAt },
    });

    log.info('API key rotated', { workspaceId, keyId: id });
    return c.json({
      data: {
        id,
        newKey: plaintext,
        maskedKey: `${prefix}...${suffix}`,
        gracePeriodEndsAt,
        message: 'Old key remains valid until grace period ends.',
      },
    });
  });

  /** POST /api/v1/api-keys/:id/revoke — immediately revoke an API key */
  app.post('/:id/revoke', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { id } = c.req.param();

    const rows = await sql`
      UPDATE mcp_api_keys SET
        status = 'revoked',
        revoked_at = now(),
        updated_at = now()
      WHERE id = ${id} AND workspace_id = ${workspaceId} AND status != 'revoked'
      RETURNING id
    ` as { id: string }[];

    if (rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found or already revoked' } }, 404);
    }

    await auditService.logAction({
      workspaceId,
      actorType: 'user',
      action: 'config_change',
      resourceType: 'api_key',
      resourceId: id,
      metadata: { action: 'revoked' },
    });

    log.info('API key revoked', { workspaceId, keyId: id });
    return c.json({ data: { revoked: true } });
  });

  return app;
}
