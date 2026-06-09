import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { ApiKeyManager } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'demo-bootstrap' });

type SqlClient = ReturnType<typeof postgres>;

const bootstrapSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

/**
 * Returns true when demo mode is enabled via the DEMO_MODE env var.
 * Read at request time (not module load) so tests and the demo script
 * can toggle it without re-importing the app.
 *
 * @returns Whether DEMO_MODE=true
 */
function isDemoMode(): boolean {
  return process.env['DEMO_MODE'] === 'true';
}

/**
 * Factory for the unauthenticated demo bootstrap route.
 *
 * `POST /bootstrap` creates a fresh workspace and an MCP API key for it,
 * returning both. The raw key is shown once and stored only as a SHA-256
 * hash (via ApiKeyManager), so the same key works against the MCP server's
 * auth path. The route is a hard no-op (404) unless DEMO_MODE=true —
 * defense in depth on top of conditional mounting in server.ts.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted under /api/v1/demo
 */
export function createDemoBootstrapRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const keyManager = new ApiKeyManager(sql);

  app.post('/bootstrap', async (c) => {
    if (!isDemoMode()) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Route /api/v1/demo/bootstrap not found' } },
        404,
      );
    }

    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = bootstrapSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.issues } },
        400,
      );
    }

    const workspaceName = parsed.data.name ?? 'Slice Demo Workspace';

    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (name)
      VALUES (${workspaceName})
      RETURNING id
    `;
    if (!workspace) {
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Workspace creation returned no row' } },
        500,
      );
    }

    const keyResult = await keyManager.createKey(workspace.id, 'demo-bootstrap');
    if (keyResult.isErr()) {
      log.error('Demo bootstrap key creation failed', { workspaceId: workspace.id, error: keyResult.error });
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'API key creation failed' } },
        500,
      );
    }

    log.warn('Demo bootstrap workspace created — DEMO_MODE only', {
      workspaceId: workspace.id,
      keyId: keyResult.value.id,
    });

    return c.json(
      { data: { workspaceId: workspace.id, apiKey: keyResult.value.rawKey } },
      201,
    );
  });

  return app;
}
