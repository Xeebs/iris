import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';

import { logger } from '@iris/core/logger';
import {
  MultiConnectorQueryOptimizer,
  type ConnectorMeta,
  type ExecutionConstraints,
} from '@iris/semantic-core/multi-connector-optimizer';

const ConnectorMetaSchema = z.object({
  connectorId: z.string().min(1),
  entityTypes: z.array(z.string()).default([]),
  avgLatencyMs: z.number().nonnegative().default(200),
  cacheHitRate: z.number().min(0).max(1).default(0.3),
  costPerRequest: z.number().nonnegative().default(1),
});

const PlanBodySchema = z.object({
  query: z.string().min(1),
  connectors: z.array(ConnectorMetaSchema).min(1),
  contextBudget: z.number().int().positive().default(4000),
  constraints: z.object({
    maxLatencyMs: z.number().int().positive().default(2000),
    maxTokens: z.number().int().positive().default(4000),
    preferLowCost: z.boolean().default(false),
  }).default({}),
  persist: z.boolean().default(true),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for multi-connector query optimization
 */
export function createMultiConnectorOptimizerRoutes(sql: Sql) {
  const app = new Hono();
  const optimizer = new MultiConnectorQueryOptimizer(sql);

  /**
   * POST /query-optimizer/plan
   * Analyze connectors and recommend an execution strategy.
   */
  app.post('/plan', zValidator('json', PlanBodySchema), async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const body = c.req.valid('json');

    const connectors: ConnectorMeta[] = body.connectors;
    const constraints: ExecutionConstraints = body.constraints;

    const planData = optimizer.selectOptimalStrategy(
      body.query,
      connectors,
      body.contextBudget,
      constraints
    );

    let plan = { planId: '', workspaceId, createdAt: new Date(), ...planData };

    if (body.persist) {
      try {
        plan = await optimizer.recordPlan(workspaceId, planData);
      } catch (e) {
        logger.warn('Failed to persist query plan, returning in-memory result', { error: e });
      }
    }

    logger.info('Query execution plan generated', {
      workspaceId,
      strategy: plan.strategy,
      connectorCount: plan.connectors.length,
      estimatedLatencyP95Ms: plan.estimatedLatencyP95Ms,
    });

    return c.json({ data: plan }, 200);
  });

  /**
   * GET /query-optimizer/history
   * Paginated history of query execution plans for a workspace.
   */
  app.get('/history', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const limit = Math.min(200, Number(c.req.query('limit') ?? '50'));
    const cursor = c.req.query('cursor');

    try {
      const { plans, nextCursor } = await optimizer.getPlanHistory(workspaceId, limit, cursor);
      return c.json({
        data: plans,
        meta: { hasMore: nextCursor !== null, nextCursor },
      });
    } catch (e) {
      logger.error('Failed to fetch query plan history', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch plan history' } }, 500);
    }
  });

  /**
   * POST /query-optimizer/estimate
   * Estimate execution cost without persisting a plan (no workspace context needed).
   */
  app.post(
    '/estimate',
    zValidator('json', z.object({
      strategy: z.enum(['parallel', 'sequential', 'filtered-first', 'cached-first']),
      connectors: z.array(ConnectorMetaSchema).min(1),
    })),
    (c) => {
      const { strategy, connectors } = c.req.valid('json');
      const estimate = optimizer.estimateExecutionCost(strategy, connectors);
      return c.json({ data: estimate });
    }
  );

  return app;
}
