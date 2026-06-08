import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { IndexRepairService } from '@iris/semantic-core/index-repair-service';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'index-repair' });

type SqlClient = ReturnType<typeof postgres>;

const rebuildBodySchema = z.object({
  entityTypeFilter: z.string().optional(),
  dryRun: z.boolean().default(false),
});

/**
 * Factory for index repair and integrity check routes.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted under /index-repair
 */
export function createIndexRepairRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const service = new IndexRepairService(
    sql as unknown as ConstructorParameters<typeof IndexRepairService>[0]
  );

  /** POST /api/v1/index-repair/scan — trigger an integrity scan */
  app.post('/scan', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const result = await service.scanIndexIntegrity(workspaceId);
    if (result.isErr()) {
      log.error('Integrity scan failed', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Scan failed' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/index-repair/scans — list past integrity scans */
  app.get('/scans', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const limit = Math.min(Number(c.req.query('limit') ?? 10), 50);
    const result = await service.listScans(workspaceId, limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list scans' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** GET /api/v1/index-repair/report — latest corruption report */
  app.get('/report', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const result = await service.reportCorruption(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch report' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/index-repair/rebuild — trigger index rebuild */
  app.post('/rebuild', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = rebuildBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await service.rebuildIndex(workspaceId, {
      entityTypeFilter: parsed.data.entityTypeFilter,
      dryRun: parsed.data.dryRun,
    });

    if (result.isErr()) {
      log.error('Rebuild failed', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Rebuild failed' } }, 500);
    }

    return c.json({ data: result.value }, parsed.data.dryRun ? 200 : 201);
  });

  /** GET /api/v1/index-repair/rebuild-jobs — list past rebuild jobs */
  app.get('/rebuild-jobs', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const limit = Math.min(Number(c.req.query('limit') ?? 10), 50);
    const result = await service.listRebuildJobs(workspaceId, limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list jobs' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/index-repair/rollback/:snapshotId — rollback to snapshot */
  app.post('/rollback/:snapshotId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { snapshotId } = c.req.param();
    const result = await service.rollbackIndexSnapshot(workspaceId, snapshotId);

    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Rollback failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
