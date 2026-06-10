import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import {
  SchemaEvolutionManager,
  type SchemaEvolutionStore,
  type SchemaVersion,
  type MigrationStatus,
} from '@iris/semantic-core/schema-evolution';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'schema-migrations' });
type SqlClient = ReturnType<typeof postgres>;

function buildStore(sql: SqlClient): SchemaEvolutionStore {
  return {
    async getVersion(connectorId, version) {
      const [row] = await sql<
        { connector_id: string; version: string; schema_json: unknown; released_at: Date; breaking_changes_json: unknown }[]
      >`
        SELECT connector_id, version, schema_json, released_at, breaking_changes_json
        FROM connector_schema_versions
        WHERE connector_id = ${connectorId} AND version = ${version}
      `;
      if (!row) return null;
      return {
        connectorId: row.connector_id,
        version: row.version,
        schema: row.schema_json as SchemaVersion['schema'],
        releasedAt: row.released_at,
        breakingChanges: row.breaking_changes_json as SchemaVersion['breakingChanges'],
      };
    },

    async listVersions(connectorId) {
      const rows = await sql<
        { connector_id: string; version: string; schema_json: unknown; released_at: Date; breaking_changes_json: unknown }[]
      >`
        SELECT connector_id, version, schema_json, released_at, breaking_changes_json
        FROM connector_schema_versions
        WHERE connector_id = ${connectorId}
        ORDER BY released_at ASC
      `;
      return rows.map((r) => ({
        connectorId: r.connector_id,
        version: r.version,
        schema: r.schema_json as SchemaVersion['schema'],
        releasedAt: r.released_at,
        breakingChanges: r.breaking_changes_json as SchemaVersion['breakingChanges'],
      }));
    },

    async saveVersion(v) {
      await sql`
        INSERT INTO connector_schema_versions
          (connector_id, version, schema_json, released_at, breaking_changes_json)
        VALUES (
          ${v.connectorId},
          ${v.version},
          ${sql.json(v.schema as unknown as Parameters<typeof sql.json>[0])},
          ${v.releasedAt},
          ${sql.json(v.breakingChanges as unknown as Parameters<typeof sql.json>[0])}
        )
        ON CONFLICT (connector_id, version) DO UPDATE SET
          schema_json = EXCLUDED.schema_json,
          released_at = EXCLUDED.released_at,
          breaking_changes_json = EXCLUDED.breaking_changes_json
      `;
    },

    async getMigrationStatus(workspaceId, connectorId, sourceVersion, targetVersion) {
      const [row] = await sql<MigrationStatus[]>`
        SELECT
          workspace_id AS "workspaceId",
          connector_id AS "connectorId",
          source_schema_version AS "sourceVersion",
          target_schema_version AS "targetVersion",
          migration_status AS "status",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          affected_entity_count AS "affectedEntityCount",
          error_message AS "errorMessage"
        FROM schema_migrations
        WHERE workspace_id = ${workspaceId}::uuid
          AND connector_id = ${connectorId}
          AND source_schema_version = ${sourceVersion}
          AND target_schema_version = ${targetVersion}
      `;
      return row ?? null;
    },

    async saveMigrationStatus(status) {
      await sql`
        INSERT INTO schema_migrations
          (workspace_id, connector_id, source_schema_version, target_schema_version, migration_status,
           started_at, affected_entity_count)
        VALUES (
          ${status.workspaceId}::uuid,
          ${status.connectorId},
          ${status.sourceVersion},
          ${status.targetVersion},
          ${status.status},
          ${status.startedAt ?? null},
          ${status.affectedEntityCount ?? null}
        )
        ON CONFLICT (workspace_id, connector_id, source_schema_version, target_schema_version) DO UPDATE SET
          migration_status = EXCLUDED.migration_status,
          started_at = EXCLUDED.started_at,
          affected_entity_count = EXCLUDED.affected_entity_count
      `;
    },

    async updateMigrationStatus(workspaceId, connectorId, sourceVersion, targetVersion, update) {
      await sql`
        UPDATE schema_migrations SET
          migration_status = COALESCE(${update.status ?? null}, migration_status),
          completed_at = COALESCE(${update.completedAt ?? null}, completed_at),
          error_message = COALESCE(${update.errorMessage ?? null}, error_message)
        WHERE workspace_id = ${workspaceId}::uuid
          AND connector_id = ${connectorId}
          AND source_schema_version = ${sourceVersion}
          AND target_schema_version = ${targetVersion}
      `;
    },
  };
}

const registerVersionSchema = z.object({
  schema: z.object({
    version: z.string().min(1),
    entityTypes: z.array(
      z.object({
        name: z.string().min(1),
        attributes: z.array(
          z.object({
            name: z.string().min(1),
            type: z.enum(['string', 'number', 'boolean', 'date', 'string[]']),
            nullable: z.boolean(),
            description: z.string().optional(),
            pii: z.boolean().optional(),
          }),
        ),
      }),
    ),
  }),
});

const startMigrationSchema = z.object({
  sourceVersion: z.string().min(1),
  targetVersion: z.string().min(1),
  affectedEntityCount: z.number().int().nonnegative().optional(),
});

/**
 * REST routes for connector schema version management and migration tracking.
 * Base path: /api/v1/connectors/:connectorId/schema
 *
 * @param sql - Postgres client
 */
export function createSchemaMigrationRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  const getSvc = () => new SchemaEvolutionManager(buildStore(sql));

  /** GET /connectors/:connectorId/schema/versions — list all recorded versions */
  app.get('/:connectorId/schema/versions', async (c) => {
    const { connectorId } = c.req.param();
    try {
      const versions = await getSvc().listVersions(connectorId);
      return c.json({ data: versions });
    } catch (e) {
      log.error('Failed to list schema versions', { connectorId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list versions' } }, 500);
    }
  });

  /** POST /connectors/:connectorId/schema/versions — register new schema version */
  app.post('/:connectorId/schema/versions', async (c) => {
    const { connectorId } = c.req.param();
    const body = await c.req.json().catch(() => null);
    const parsed = registerVersionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid schema', details: parsed.error.issues } }, 400);
    }

    const result = await getSvc().registerVersion(connectorId, parsed.data.schema as Parameters<ReturnType<typeof getSvc>['registerVersion']>[1]);
    if (result.isErr()) {
      return c.json({ error: { code: result.error.code, message: result.error.message } }, 422);
    }

    return c.json({ data: { connectorId, changes: result.value } }, 201);
  });

  /** GET /connectors/:connectorId/schema/migration-plan — compute diff between two versions */
  app.get('/:connectorId/schema/migration-plan', async (c) => {
    const { connectorId } = c.req.param();
    const { from: sourceVersion, to: targetVersion } = c.req.query();

    if (!sourceVersion || !targetVersion) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'from and to query params required' } }, 400);
    }

    const result = await getSvc().buildMigrationPlan(connectorId, sourceVersion, targetVersion);
    if (result.isErr()) {
      const status = result.error.code === 'VERSION_NOT_FOUND' ? 404 : 422;
      return c.json({ error: { code: result.error.code, message: result.error.message } }, status);
    }

    return c.json({ data: result.value });
  });

  /** POST /connectors/:connectorId/schema/migrations — start a workspace migration */
  app.post('/:connectorId/schema/migrations', async (c) => {
    const { connectorId } = c.req.param();
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = startMigrationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } }, 400);
    }

    const svc = getSvc();
    const planResult = await svc.buildMigrationPlan(connectorId, parsed.data.sourceVersion, parsed.data.targetVersion);
    if (planResult.isErr()) {
      return c.json({ error: { code: planResult.error.code, message: planResult.error.message } }, 404);
    }

    const migResult = await svc.startMigration(
      workspaceId,
      connectorId,
      planResult.value,
      parsed.data.affectedEntityCount,
    );
    if (migResult.isErr()) {
      return c.json({ error: { code: migResult.error.code, message: migResult.error.message } }, 409);
    }

    return c.json({ data: migResult.value }, 201);
  });

  /** GET /connectors/:connectorId/schema/migrations — list workspace migrations */
  app.get('/:connectorId/schema/migrations', async (c) => {
    const { connectorId } = c.req.param();
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    try {
      const rows = await sql<MigrationStatus[]>`
        SELECT
          workspace_id AS "workspaceId",
          connector_id AS "connectorId",
          source_schema_version AS "sourceVersion",
          target_schema_version AS "targetVersion",
          migration_status AS "status",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          affected_entity_count AS "affectedEntityCount"
        FROM schema_migrations
        WHERE workspace_id = ${workspaceId}::uuid AND connector_id = ${connectorId}
        ORDER BY created_at DESC
      `;
      return c.json({ data: rows });
    } catch (e) {
      log.error('Failed to list migrations', { connectorId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list migrations' } }, 500);
    }
  });

  return app;
}
