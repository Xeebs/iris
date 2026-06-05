import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { MetricRegistry } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'metrics' });

type SqlClient = ReturnType<typeof postgres>;

const defineMetricSchema = z.object({
  name: z.string().min(1).max(200),
  formula: z.string().min(1),
  description: z.string().min(1),
});

/**
 * Creates Hono route handlers for the metrics API.
 * @param sql - Postgres client
 * @returns Hono app with metrics routes
 */
export function createMetricRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const registry = new MetricRegistry(sql);

  /** GET /api/v1/metrics?workspaceId= */
  routes.get('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const result = await registry.listMetrics(workspaceId);
    if (result.isErr()) {
      log.error('Failed to list metrics', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list metrics' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/metrics?workspaceId= */
  routes.post('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = defineMetricSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } },
        400,
      );
    }

    const result = await registry.defineMetric(
      workspaceId,
      body.data.name,
      body.data.formula,
      body.data.description,
    );
    if (result.isErr()) {
      log.error('Failed to define metric', { workspaceId, name: body.data.name, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to define metric' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** DELETE /api/v1/metrics/:name?workspaceId= */
  routes.delete('/:name', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const name = c.req.param('name');
    const result = await registry.deleteMetric(workspaceId, name);
    if (result.isErr()) {
      log.error('Failed to delete metric', { workspaceId, name, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete metric' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Metric "${name}" not found` } }, 404);
    }
    return c.json({ data: { deleted: true } });
  });

  return routes;
}
