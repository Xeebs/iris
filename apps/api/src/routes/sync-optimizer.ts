import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';

import { logger } from '@iris/core/logger';
import { SyncParallelismOptimizer, type HistoricalMetrics } from '@iris/semantic-core/sync-parallelism-optimizer';

const HistoricalMetricsSchema = z.object({
  concurrency: z.number().int().positive(),
  throughputPerSec: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  errorRate: z.number().min(0).max(1),
  entityCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

const TuningBodySchema = z.object({
  entityType: z.string().default('*'),
  historicalMetrics: z.array(HistoricalMetricsSchema).optional().default([]),
  autoApply: z.boolean().default(false),
});

const ExperimentBodySchema = z.object({
  variantName: z.string().min(1),
  concurrency: z.number().int().min(1).max(50),
  batchSize: z.number().int().min(1).max(5000),
  trafficPct: z.number().min(0).max(100).default(10),
});

export function createSyncOptimizerRoutes(sql: Sql) {
  const app = new Hono();
  const optimizer = new SyncParallelismOptimizer(sql);

  /**
   * POST /sync-optimizer/tuning/:connectorId
   * Triggers auto-tuning and optionally persists the recommendation.
   */
  app.post(
    '/tuning/:connectorId',
    zValidator('json', TuningBodySchema),
    async (c) => {
      const connectorId = c.req.param('connectorId');
      const workspaceId = c.req.header('x-workspace-id') ?? 'default';
      const body = c.req.valid('json');

      const metrics: HistoricalMetrics[] = body.historicalMetrics;
      const { current, recommendation } = await optimizer.getConfigWithRecommendation(
        connectorId,
        workspaceId,
        metrics
      );

      if (body.autoApply) {
        await optimizer.saveConfig({
          connectorId,
          workspaceId,
          entityType: body.entityType,
          concurrency: recommendation.recommendedConcurrency,
          batchSize: recommendation.recommendedBatchSize,
          workerWeight: current.workerWeight,
          autoTune: current.autoTune,
          lastTunedAt: new Date(),
        });
        logger.info('Auto-tuning applied', { connectorId, workspaceId, recommendation });
      }

      return c.json({ data: { current, recommendation, applied: body.autoApply } });
    }
  );

  /**
   * GET /sync-optimizer/config/:connectorId
   * Returns current settings plus a tuning recommendation.
   */
  app.get('/config/:connectorId', async (c) => {
    const connectorId = c.req.param('connectorId');
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const { current, recommendation } = await optimizer.getConfigWithRecommendation(
      connectorId,
      workspaceId,
      []
    );

    return c.json({ data: { current, recommendation } });
  });

  /**
   * POST /sync-optimizer/experiments/:connectorId
   * Starts an A/B concurrency experiment.
   */
  app.post(
    '/experiments/:connectorId',
    zValidator('json', ExperimentBodySchema),
    async (c) => {
      const connectorId = c.req.param('connectorId');
      const workspaceId = c.req.header('x-workspace-id') ?? 'default';
      const body = c.req.valid('json');

      const window = await optimizer.detectOptimizationWindow(connectorId, workspaceId);
      if (!window.stableEnough) {
        return c.json(
          { error: { code: 'UNSTABLE_WINDOW', message: window.reason } },
          422
        );
      }

      const experimentId = await optimizer.executeOptimizationExperiment(
        connectorId,
        workspaceId,
        {
          name: body.variantName,
          concurrency: body.concurrency,
          batchSize: body.batchSize,
          trafficPct: body.trafficPct,
        }
      );

      return c.json({ data: { experimentId, connectorId, workspaceId } }, 201);
    }
  );

  /**
   * GET /sync-optimizer/experiments
   * Lists completed experiments for a connector.
   */
  app.get('/experiments', async (c) => {
    const connectorId = c.req.query('connectorId');
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const limit = Number(c.req.query('limit') ?? '20');

    if (!connectorId) {
      return c.json(
        { error: { code: 'MISSING_PARAM', message: 'connectorId query param is required' } },
        400
      );
    }

    const experiments = await optimizer.listExperiments(connectorId, workspaceId, limit);
    return c.json({ data: experiments, meta: { count: experiments.length } });
  });

  /**
   * GET /sync-optimizer/window/:connectorId
   * Checks whether conditions are stable enough for a tuning experiment.
   */
  app.get('/window/:connectorId', async (c) => {
    const connectorId = c.req.param('connectorId');
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const window = await optimizer.detectOptimizationWindow(connectorId, workspaceId);
    return c.json({ data: window });
  });

  return app;
}
