import { Hono } from 'hono';
import { z } from 'zod';
import { DataLineageService } from '@iris/semantic-core/data-lineage';
import { logger } from '@iris/core/logger';

import type postgres from 'postgres';
type SqlFn = ReturnType<typeof postgres>;

const log = logger.child({ route: 'data-lineage' });

const changeImpactSchema = z.object({
  entityId: z.string().min(1),
  changeType: z.enum(['update', 'delete', 'retype']).default('update'),
  maxDepth: z.number().int().min(1).max(10).default(3),
});

/**
 * Create Hono routes for data lineage REST endpoints.
 * @param sql - Postgres client
 * @returns Hono app with lineage routes mounted
 */
export function createDataLineageRoutes(sql: SqlFn) {
  const app = new Hono();
  const svc = new DataLineageService(sql);

  // GET /entities/:id/lineage — full lineage record for an entity
  app.get('/entities/:id/lineage', async (c) => {
    const entityId = c.req.param('id');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    try {
      const record = await svc.getLineage(entityId, workspaceId);
      if (!record) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'No lineage record for this entity' } }, 404);
      }
      return c.json({ data: record });
    } catch (e) {
      log.error('Failed to get lineage', { entityId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'LINEAGE_FAILED', message: 'Failed to retrieve lineage' } }, 500);
    }
  });

  // GET /entities/:id/lineage-graph — ancestor + descendant graph
  app.get('/entities/:id/lineage-graph', async (c) => {
    const entityId = c.req.param('id');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const maxDepth = Math.min(10, parseInt(c.req.query('maxDepth') ?? '3', 10));
    const result = await svc.getLineageGraph(entityId, workspaceId, maxDepth);
    if (result.isErr()) {
      log.error('Failed to build lineage graph', { entityId, error: result.error.message });
      return c.json({ error: { code: 'GRAPH_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // GET /entities/:id/impact — what depends on this entity
  app.get('/entities/:id/impact', async (c) => {
    const entityId = c.req.param('id');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const maxDepth = Math.min(10, parseInt(c.req.query('maxDepth') ?? '3', 10));
    const result = await svc.computeImpact(entityId, workspaceId, maxDepth);
    if (result.isErr()) {
      log.error('Failed to compute impact', { entityId, error: result.error.message });
      return c.json({ error: { code: 'IMPACT_FAILED', message: result.error.message } }, 500);
    }
    log.info('Impact computed', { entityId, affectedCount: result.value.affectedCount });
    return c.json({ data: result.value });
  });

  // POST /lineage/change-impact — simulate a change and show impact
  app.post('/lineage/change-impact', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => ({})) as unknown;
    const parsed = changeImpactSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 400);
    }
    const { entityId, maxDepth } = parsed.data;
    const result = await svc.computeImpact(entityId, workspaceId, maxDepth);
    if (result.isErr()) {
      return c.json({ error: { code: 'IMPACT_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { ...result.value, changeType: parsed.data.changeType } });
  });

  // GET /entities — paginated lineage list for workspace
  app.get('/lineage', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const limit = Math.min(200, parseInt(c.req.query('limit') ?? '50', 10));
    const cursor = c.req.query('cursor') ?? undefined;
    try {
      const records = await svc.listEntityLineage(workspaceId, limit, cursor);
      const nextCursor = records.length === limit ? records[records.length - 1]?.lastModifiedAt.toISOString() : undefined;
      return c.json({ data: records, meta: { hasMore: records.length === limit, nextCursor } });
    } catch (e) {
      log.error('Failed to list lineage', { workspaceId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'LIST_FAILED', message: 'Failed to list lineage' } }, 500);
    }
  });

  return app;
}
