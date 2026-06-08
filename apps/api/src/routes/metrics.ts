import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { MetricRegistry } from '@iris/semantic-core';
import { MetricFormulaEngine, validateFormula } from '@iris/semantic-core/metric-formula-engine';
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
  const formulaEngine = new MetricFormulaEngine(sql);

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

  /** GET /api/v1/metrics/available — list all metrics with formulae (alias for listing) */
  routes.get('/available', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await registry.listMetrics(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /api/v1/metrics/:id/evaluate — evaluate a metric formula */
  routes.post('/:id/evaluate', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const metricResult = await registry.getMetric(workspaceId, c.req.param('id'));
    if (metricResult.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: metricResult.error.message } }, 500);
    if (!metricResult.value) return c.json({ error: { code: 'NOT_FOUND', message: 'Metric not found' } }, 404);

    const evalResult = await formulaEngine.evaluate(
      c.req.param('id'), workspaceId, metricResult.value.formula,
    );
    if (evalResult.isErr()) return c.json({ error: { code: 'FORMULA_ERROR', message: evalResult.error.message } }, 422);
    return c.json({ data: { metric: metricResult.value, evaluation: evalResult.value } });
  });

  /** POST /api/v1/metrics/validate-formula — validate formula syntax without saving */
  routes.post('/validate-formula', async (c) => {
    const body = await c.req.json().catch(() => null) as { formula?: string } | null;
    if (!body?.formula) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'formula is required' } }, 400);
    const errors = validateFormula(body.formula);
    if (errors.length > 0) return c.json({ data: { valid: false, errors } });
    return c.json({ data: { valid: true, errors: [] } });
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
