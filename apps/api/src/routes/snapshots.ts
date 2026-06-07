import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { IndexSnapshotService } from '@iris/semantic-core/index-snapshot';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'snapshots' });
type SqlClient = ReturnType<typeof postgres>;

const createSnapshotSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).optional(),
});

/**
 * Routes for index snapshot management (disaster recovery).
 * Mounted under /api/v1/snapshots.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createSnapshotRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const snapshots = new IndexSnapshotService(sql as ConstructorParameters<typeof IndexSnapshotService>[0]);

  /** GET /api/v1/snapshots — list all snapshots for the workspace */
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const result = await snapshots.listSnapshots(workspaceId);
    if (result.isErr()) {
      log.error('Failed to list snapshots', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list snapshots' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/snapshots — trigger a new snapshot */
  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    let body: z.infer<typeof createSnapshotSchema>;
    try {
      const raw = await c.req.json().catch(() => ({}));
      body = createSnapshotSchema.parse(raw);
    } catch (e) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: String(e) } }, 400);
    }

    const result = await snapshots.createSnapshot(workspaceId, body.retentionDays);
    if (result.isErr()) {
      log.error('Failed to create snapshot', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create snapshot' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** POST /api/v1/snapshots/:id/restore — restore workspace from a snapshot */
  app.post('/:id/restore', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { id } = c.req.param();
    const result = await snapshots.restoreFromSnapshot(workspaceId, id);

    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      if (msg.includes('not in ready state')) {
        return c.json({ error: { code: 'CONFLICT', message: msg } }, 409);
      }
      log.error('Failed to restore snapshot', { workspaceId, snapshotId: id, error: msg });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to restore snapshot' } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
