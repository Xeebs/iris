import { Hono } from 'hono';
import { z } from 'zod';
import {
  clusterQueriesBySemanticSimilarity,
  adaptiveTtlAssignment,
  detectCacheInvalidationPatterns,
  persistClusters,
} from '@iris/semantic-core/query-cluster-engine';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'query-clustering' });

type Sql = Parameters<typeof clusterQueriesBySemanticSimilarity>[0];
type SqlBindings = { sql: Sql };

const app = new Hono<{ Bindings: SqlBindings }>();

function getSql(c: { env: unknown }) {
  return (c.env as SqlBindings | undefined)?.sql;
}

const TtlAssignSchema = z.object({
  queryHash: z.string().min(1),
  queryEmbedding: z.array(z.number()).min(1),
});

const InvalidationSchema = z.object({
  triggerEntityType: z.string().min(1),
});

/** GET /cache/clusters — list active clusters for workspace */
app.get('/clusters', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const days = parseInt(c.req.query('days') ?? '7', 10);

  const sql = getSql(c);
  const result = await clusterQueriesBySemanticSimilarity(sql!, workspaceId, days);

  if (result.isErr()) {
    log.error('Failed to cluster queries', { error: result.error.message });
    return c.json({ error: { code: 'CLUSTER_ERROR', message: 'Failed to compute clusters' } }, 500);
  }

  if (sql && result.value.length > 0) {
    await persistClusters(sql, result.value, []).catch(e =>
      log.warn('Failed to persist clusters', { error: (e as Error).message }),
    );
  }

  return c.json({ data: result.value, meta: { count: result.value.length, days } });
});

/** GET /cache/clusters/:clusterId — get cluster detail with TTL strategy */
app.get('/clusters/:clusterId', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const clusterId = c.req.param('clusterId');

  const sql = getSql(c);
  const allResult = await clusterQueriesBySemanticSimilarity(sql!, workspaceId, 7);

  if (allResult.isErr()) {
    return c.json({ error: { code: 'CLUSTER_ERROR', message: 'Failed to load clusters' } }, 500);
  }

  const cluster = allResult.value.find(c => c.clusterId === clusterId);
  if (!cluster) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Cluster not found' } }, 404);
  }

  return c.json({ data: cluster });
});

/** POST /cache/assign-ttl — get adaptive TTL for a query */
app.post('/assign-ttl', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = TtlAssignSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
  }

  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const { queryHash, queryEmbedding } = parsed.data;

  const sql = getSql(c);
  const result = await adaptiveTtlAssignment(sql!, workspaceId, queryHash, queryEmbedding);

  if (result.isErr()) {
    return c.json({ error: { code: 'TTL_ERROR', message: 'Failed to assign TTL' } }, 500);
  }

  return c.json({ data: result.value });
});

/** POST /cache/invalidate — detect affected clusters for entity type change */
app.post('/invalidate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = InvalidationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'triggerEntityType required' } }, 400);
  }

  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const { triggerEntityType } = parsed.data;

  const sql = getSql(c);
  const result = await detectCacheInvalidationPatterns(sql!, workspaceId, triggerEntityType);

  if (result.isErr()) {
    return c.json({ error: { code: 'INVALIDATION_ERROR', message: 'Failed to compute invalidation' } }, 500);
  }

  return c.json({ data: result.value });
});

export default app;
