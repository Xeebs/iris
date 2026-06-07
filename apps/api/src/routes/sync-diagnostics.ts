import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { SyncDiagnosticsService } from '@iris/semantic-core/sync-diagnostics';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'sync-diagnostics' });
type SqlClient = ReturnType<typeof postgres>;

const recordSchema = z.object({
  syncJobId: z.string().min(1),
  connectorInstanceId: z.string().min(1),
  errorMessage: z.string().min(1),
  errorDetails: z.record(z.unknown()).optional(),
});

/**
 * Routes for sync error diagnostics.
 * Mounted under /api/v1/admin/sync-diagnostics.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createSyncDiagnosticsRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const diagnostics = new SyncDiagnosticsService(sql as ConstructorParameters<typeof SyncDiagnosticsService>[0]);

  /** GET /api/v1/admin/sync-diagnostics/:connectorInstanceId — last 10 errors with categorization */
  app.get('/:connectorInstanceId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { connectorInstanceId } = c.req.param();
    const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 50);

    const [diagResult, healthResult] = await Promise.all([
      diagnostics.getDiagnostics(connectorInstanceId, limit),
      diagnostics.analyzeConnectorHealth(connectorInstanceId),
    ]);

    if (diagResult.isErr()) {
      log.error('Failed to get sync diagnostics', { connectorInstanceId, error: diagResult.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve diagnostics' } }, 500);
    }

    return c.json({
      data: {
        diagnostics: diagResult.value,
        health: healthResult,
      },
    });
  });

  /** POST /api/v1/admin/sync-diagnostics — record a new sync error */
  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    let body: z.infer<typeof recordSchema>;
    try {
      body = recordSchema.parse(await c.req.json());
    } catch (e) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: String(e) } }, 400);
    }

    const result = await diagnostics.recordDiagnostic(
      body.syncJobId,
      body.connectorInstanceId,
      workspaceId,
      body.errorMessage,
      body.errorDetails,
    );

    if (result.isErr()) {
      log.error('Failed to record sync diagnostic', { error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to record diagnostic' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** POST /api/v1/admin/sync-diagnostics/:id/resolve — mark a diagnostic as resolved */
  app.post('/:id/resolve', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { id } = c.req.param();
    const result = await diagnostics.resolve(id);

    if (result.isErr()) {
      log.error('Failed to resolve sync diagnostic', { id, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve diagnostic' } }, 500);
    }

    return c.json({ data: { resolved: true, id } });
  });

  return app;
}
