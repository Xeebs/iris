import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { DedupInspector } from '@iris/semantic-core/dedup-inspector';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'dedup-admin-routes' });

const MergeBody = z.object({
  entity1Id: z.string().min(1),
  entity2Id: z.string().min(1),
  canonicalId: z.string().min(1),
});

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createDedupAdminRoutes(sql: Sql) {
  const router = new Hono();
  const inspector = new DedupInspector(sql as never);

  router.get('/clusters', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const entityType = c.req.query('entityType') ?? undefined;
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

    const result = await inspector.analyzeDedupClusters(workspaceId, entityType, limit);
    if (result.isErr()) {
      log.error('Failed to list clusters', { error: result.error.message });
      return c.json({ error: { code: 'FETCH_FAILED', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  router.get('/clusters/:clusterId/members', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const { clusterId } = c.req.param();

    const clusterResult = await inspector.analyzeDedupClusters(workspaceId, undefined, 200);
    if (clusterResult.isErr()) {
      return c.json({ error: { code: 'FETCH_FAILED', message: clusterResult.error.message } }, 500);
    }

    const cluster = clusterResult.value.find((cl) => cl.clusterId === clusterId);
    if (!cluster) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Cluster not found' } }, 404);
    }

    return c.json({ data: cluster.members, meta: { clusterId, memberCount: cluster.memberCount } });
  });

  router.post('/merge', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const userId = c.req.header('x-user-id') ?? 'system';

    const parsed = MergeBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.format() } }, 400);
    }

    const { entity1Id, entity2Id, canonicalId } = parsed.data;

    const result = await inspector.approveMerge(entity1Id, entity2Id, canonicalId, userId, workspaceId);
    if (result.isErr()) {
      log.error('Merge failed', { error: result.error.message });
      return c.json({ error: { code: 'MERGE_FAILED', message: result.error.message } }, 500);
    }

    log.info('Merge approved via API', { entity1Id, entity2Id, canonicalId, workspaceId });
    return c.json({ data: result.value }, 201);
  });

  router.get('/entities/:entityId/dedup-status', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const { entityId } = c.req.param();

    try {
      const clusterResult = await inspector.analyzeDedupClusters(workspaceId);
      if (clusterResult.isErr()) {
        return c.json({ error: { code: 'FETCH_FAILED', message: clusterResult.error.message } }, 500);
      }

      const matchingCluster = clusterResult.value.find(
        (cl) => cl.canonicalEntityId === entityId || cl.members.some((m) => m.entityId === entityId),
      );

      return c.json({
        data: {
          entityId,
          isPartOfCluster: !!matchingCluster,
          clusterId: matchingCluster?.clusterId ?? null,
          isCanonical: matchingCluster?.canonicalEntityId === entityId,
          mergedAt: matchingCluster?.mergedAt ?? null,
        },
      });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: String(e) } }, 500);
    }
  });

  return router;
}
