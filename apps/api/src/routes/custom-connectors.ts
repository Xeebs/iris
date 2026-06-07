import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import type { JSONValue } from 'postgres';
import path from 'node:path';

import { logger } from '@iris/core/logger';
import { validateConnectorDefinition } from '@iris/connector-sdk/user-connector-loader';

const log = logger.child({ route: 'custom-connectors' });

type SqlClient = ReturnType<typeof postgres>;

// Safe directory where custom connector code is stored
const CONNECTOR_SANDBOX_DIR =
  process.env['CUSTOM_CONNECTOR_DIR'] ?? '/tmp/iris-custom-connectors';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
  status: z.enum(['pending', 'active', 'disabled', 'error']).optional(),
});

const validateBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  definition: z.record(z.unknown()),
});

const uploadBodySchema = validateBodySchema.extend({
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
});

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /custom-connectors
 */
export function createCustomConnectorRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /custom-connectors — list installed custom connectors for workspace */
  app.get('/', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { limit, cursor, status } = parsed.data;
    const statusFilter = status ?? null;

    try {
      const rows = cursor
        ? await sql`
            SELECT id, workspace_id, name, description, version, status,
                   manifest, validation_errors, created_at, updated_at
            FROM custom_connectors
            WHERE workspace_id = ${workspaceId}
              AND (${statusFilter}::text IS NULL OR status = ${statusFilter}::text)
              AND created_at < (SELECT created_at FROM custom_connectors WHERE id = ${cursor})
            ORDER BY created_at DESC
            LIMIT ${limit + 1}
          `
        : await sql`
            SELECT id, workspace_id, name, description, version, status,
                   manifest, validation_errors, created_at, updated_at
            FROM custom_connectors
            WHERE workspace_id = ${workspaceId}
              AND (${statusFilter}::text IS NULL OR status = ${statusFilter}::text)
            ORDER BY created_at DESC
            LIMIT ${limit + 1}
          `;

      const hasMore = rows.length > limit;
      const connectors = rows.slice(0, limit);
      const nextCursor =
        hasMore && connectors.length > 0
          ? (connectors[connectors.length - 1] as { id: string }).id
          : undefined;

      return c.json({
        data: connectors.map((r) => mapRow(r as ConnectorRow)),
        meta: { hasMore, ...(nextCursor ? { nextCursor } : {}) },
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to list custom connectors', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list connectors' } }, 500);
    }
  });

  /** GET /custom-connectors/:id — get a single custom connector */
  app.get('/:id', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const id = c.req.param('id');

    try {
      const rows = await sql`
        SELECT id, workspace_id, name, description, version, status,
               manifest, validation_errors, created_at, updated_at
        FROM custom_connectors
        WHERE id = ${id} AND workspace_id = ${workspaceId}
      `;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Custom connector not found' } }, 404);
      }

      return c.json({ data: mapRow(rows[0] as ConnectorRow) });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to get custom connector', { workspaceId, id, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get connector' } }, 500);
    }
  });

  /**
   * POST /custom-connectors/validate
   * Validate a connector definition before installation.
   * Body: { name, description?, definition: { manifest, createConnector } }
   */
  app.post('/validate', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = validateBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const errors = validateConnectorDefinition(parsed.data.definition);

    if (errors.length > 0) {
      return c.json({ data: { valid: false, errors } }, 200);
    }

    return c.json({ data: { valid: true, errors: [] } }, 200);
  });

  /**
   * POST /custom-connectors/upload
   * Install a validated connector into the workspace.
   * Body: { name, description?, version?, definition: { manifest, createConnector } }
   */
  app.post('/upload', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = uploadBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { name, description, version, definition } = parsed.data;

    // Validate connector before installing
    const validationErrors = validateConnectorDefinition(definition);
    const isValid = validationErrors.length === 0;

    if (!isValid) {
      return c.json(
        {
          error: {
            code: 'CONNECTOR_VALIDATION_FAILED',
            message: 'Connector definition failed validation',
            details: validationErrors,
          },
        },
        422,
      );
    }

    const manifest = (definition as Record<string, unknown>)['manifest'] as Record<string, unknown>;
    const installPath = path.join(CONNECTOR_SANDBOX_DIR, workspaceId, manifest['id'] as string);

    try {
      const rows = await sql`
        INSERT INTO custom_connectors
          (workspace_id, name, description, version, status, install_path, manifest)
        VALUES (
          ${workspaceId}, ${name}, ${description ?? null}, ${version},
          'active', ${installPath}, ${sql.json(manifest as unknown as JSONValue)}
        )
        ON CONFLICT (workspace_id, name) DO UPDATE SET
          description = EXCLUDED.description,
          version = EXCLUDED.version,
          status = 'active',
          manifest = EXCLUDED.manifest,
          validation_errors = NULL,
          updated_at = now()
        RETURNING id, workspace_id, name, description, version, status,
                  manifest, validation_errors, created_at, updated_at
      `;

      log.info('Custom connector installed', { workspaceId, name, version });
      return c.json({ data: mapRow(rows[0] as ConnectorRow) }, 201);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to install custom connector', { workspaceId, name, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to install connector' } }, 500);
    }
  });

  /** DELETE /custom-connectors/:id — disable/remove a custom connector */
  app.delete('/:id', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const id = c.req.param('id');

    try {
      const rows = await sql`
        UPDATE custom_connectors
        SET status = 'disabled', updated_at = now()
        WHERE id = ${id} AND workspace_id = ${workspaceId}
        RETURNING id
      `;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Custom connector not found' } }, 404);
      }

      return c.json({ data: { id, status: 'disabled' } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to disable custom connector', { workspaceId, id, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to disable connector' } }, 500);
    }
  });

  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ConnectorRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  version: string;
  status: string;
  manifest: unknown;
  validation_errors: unknown;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: ConnectorRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    version: row.version,
    status: row.status,
    manifest: row.manifest,
    validationErrors: row.validation_errors,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
