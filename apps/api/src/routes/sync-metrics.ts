import { Hono } from 'hono';
import { z } from 'zod';

import { SyncOptimizer } from '@iris/semantic-core/sync-optimizer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'sync-metrics' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const logMetricSchema = z.object({
  syncId: z.string().min(1),
  batchSize: z.number().int().min(1).max(10_000),
  entityCount: z.number().int().min(0),
  tokenCount: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  apiCalls: z.number().int().min(0).default(0),
  rateLimited: z.boolean().default(false),
  errorCount: z.number().int().min(0).default(0),
});

/**
 * Factory for sync metrics and optimization routes.
 *
 * @param sql - Postgres client
 * @returns Hono router for sync metrics endpoints
 */
export function createSyncMetricsRoutes(sql: SqlFn): Hono {
  const app = new Hono();
  const optimizer = new SyncOptimizer(sql);

  /** GET /api/v1/connectors/:connectorId/sync-metrics — fetch latency stats */
  app.get('/:connectorId/sync-metrics', async (c) => {
    const { connectorId } = c.req.param();
    const days = Number(c.req.query('days') ?? '30');
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const result = await optimizer.analyzeHistoricalSyncMetrics(connectorId, isNaN(days) ? 30 : days);
    if (result.isErr()) {
      log.error('Failed to fetch sync metrics', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/connectors/:connectorId/sync-metrics — log a batch metric */
  app.post('/:connectorId/sync-metrics', async (c) => {
    const { connectorId } = c.req.param();
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = logMetricSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid metric payload', details: parsed.error.flatten() } }, 400);
    }

    const d = parsed.data;
    const result = await optimizer.logSyncMetric({
      connector_id: connectorId,
      sync_id: d.syncId,
      workspace_id: workspaceId,
      batch_size: d.batchSize,
      entity_count: d.entityCount,
      token_count: d.tokenCount,
      duration_ms: d.durationMs,
      api_calls: d.apiCalls,
      rate_limited: d.rateLimited,
      error_count: d.errorCount,
    });

    if (result.isErr()) {
      log.error('Failed to log sync metric', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: { logged: true } }, 201);
  });

  /** POST /api/v1/connectors/:connectorId/optimize — trigger optimization analysis */
  app.post('/:connectorId/optimize', async (c) => {
    const { connectorId } = c.req.param();
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const cpuCount = Number(c.req.query('cpuCount') ?? '4');
    const result = await optimizer.getOptimizationReport(connectorId, workspaceId, isNaN(cpuCount) ? 4 : cpuCount);

    if (result.isErr()) {
      log.error('Failed to run optimization', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    log.info('Optimization report generated', { connectorId, bottleneck: result.value.bottleneck });
    return c.json({ data: result.value }, 201);
  });

  return app;
}
