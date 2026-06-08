import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { VectorHealthService } from '@iris/semantic-core/vector-health';
import { createDefaultProvider } from '@iris/semantic-core/embedding-provider';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ route: 'vector-health' });

const RunCheckSchema = z.object({
  workspaceId: z.string().min(1),
  sampleSize: z.number().int().min(10).max(10000).optional(),
});

/**
 * Create admin routes for vector index health monitoring.
 *
 * @param sql - Postgres client
 * @returns   - Hono router mounted at /admin/vector-health
 */
export function createVectorHealthRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /admin/vector-health?workspaceId=xxx — return latest report and history */
  app.get('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const provider = createDefaultProvider();
    const service = new VectorHealthService(sql, provider);
    const history = await service.getHealthHistory(workspaceId);

    return c.json({ data: { latest: history[0] ?? null, history } }, 200);
  });

  /** POST /admin/vector-health/run — trigger a health check for a workspace */
  app.post('/run', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } }, 400);
    }

    const parsed = RunCheckSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, sampleSize } = parsed.data;
    log.info('Running vector health check', { workspaceId, sampleSize });

    const provider = createDefaultProvider();
    const service = new VectorHealthService(sql, provider);

    try {
      const report = await service.generateHealthReport(workspaceId, sampleSize);
      return c.json({ data: report }, 200);
    } catch (e) {
      log.error('Health check failed', { workspaceId, error: e });
      return c.json({
        error: {
          code: 'HEALTH_CHECK_FAILED',
          message: e instanceof Error ? e.message : 'Health check failed',
        },
      }, 500);
    }
  });

  return app;
}
