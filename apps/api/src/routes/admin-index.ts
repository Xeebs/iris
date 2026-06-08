import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { IndexMaintenanceService, type MaintenanceJobType } from '@iris/semantic-core/index-maintenance';

type SqlClient = ReturnType<typeof postgres>;

const triggerSchema = z.object({
  workspaceId: z.string().min(1),
  options: z.object({
    threshold: z.number().min(0).max(1).optional(),
    maxAgeDays: z.number().int().min(1).optional(),
  }).optional().default({}),
});

const JOB_TYPES: MaintenanceJobType[] = ['deduplicate', 'prune_stale', 'rebalance', 'integrity_check'];

/**
 * Admin routes for index health monitoring and maintenance job management.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted at /admin/index
 */
export function createAdminIndexRoutes(sql: SqlClient) {
  const app = new Hono();
  const getSvc = () => new IndexMaintenanceService(sql);

  /** GET /admin/index/maintenance?workspaceId=&limit= */
  app.get('/maintenance', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const result = await getSvc().listJobs(workspaceId, limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /admin/index/maintenance/:jobType/trigger */
  app.post('/maintenance/:jobType/trigger', async (c) => {
    const jobType = c.req.param('jobType') as MaintenanceJobType;
    if (!JOB_TYPES.includes(jobType)) {
      return c.json({ error: { code: 'INVALID_JOB_TYPE', message: `Job type must be one of: ${JOB_TYPES.join(', ')}` } }, 400);
    }

    const parsed = triggerSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, options } = parsed.data;
    const svc = getSvc();

    let result;
    switch (jobType) {
      case 'deduplicate':
        result = await svc.deduplicateIndex(workspaceId, options?.threshold);
        break;
      case 'prune_stale':
        result = await svc.pruneStaleEntities(workspaceId, options?.maxAgeDays);
        break;
      case 'rebalance':
        result = await svc.rebalanceVectorIndex(workspaceId);
        break;
      case 'integrity_check':
        result = await svc.validateIndexIntegrity(workspaceId);
        break;
    }

    if (result.isErr()) {
      return c.json({ error: { code: 'JOB_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { jobType, result: result.value } });
  });

  /** GET /admin/index/health?workspaceId= */
  app.get('/health', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const result = await getSvc().getIndexHealth(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
