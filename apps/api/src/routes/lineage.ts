import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { DataLineageService } from '@iris/semantic-core/data-lineage';

type SqlClient = ReturnType<typeof postgres>;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

/**
 * REST routes for data lineage and impact analysis.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createLineageRoutes(sql: SqlClient) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new DataLineageService(sql as unknown as any);

  const getWorkspaceId = (c: Context) =>
    (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');

  /** GET /lineage — list workspace lineage records (paginated) */
  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    try {
      const records = await svc.listEntityLineage(workspaceId, parsed.data.limit ?? 50, parsed.data.cursor);
      const nextCursor = records.length > 0 ? records[records.length - 1]?.lastModifiedAt.toISOString() : null;
      return c.json({ data: records, meta: { nextCursor, hasMore: records.length === (parsed.data.limit ?? 50) } });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: (e as Error).message } }, 500);
    }
  });

  /** GET /lineage/:entityId — fetch lineage for a single entity */
  app.get('/:entityId', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    try {
      const record = await svc.getLineage(c.req.param('entityId'), workspaceId);
      if (!record) return c.json({ error: { code: 'NOT_FOUND', message: 'No lineage record found for this entity' } }, 404);
      return c.json({ data: record });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: (e as Error).message } }, 500);
    }
  });

  /** POST /lineage/:entityId/impact-analysis — compute which entities are affected by a change to this entity */
  app.post('/:entityId/impact-analysis', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const entityId = c.req.param('entityId');
    const maxDepth = parseInt(c.req.query('maxDepth') ?? '3', 10);
    const result = await svc.computeImpact(entityId, workspaceId, maxDepth);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return app;
}
