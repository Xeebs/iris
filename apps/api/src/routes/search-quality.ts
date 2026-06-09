import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import {
  SearchQualityEvaluator,
  computeMetrics,
  compareStrategies,
  type RetrievalStrategy,
} from '@iris/semantic-core/search-quality-evaluator';

const RETRIEVAL_STRATEGIES = ['vector', 'bm25', 'hybrid'] as const;

const TestSetBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  queries: z.array(z.object({
    query: z.string().min(1),
    expectedEntityIds: z.array(z.string()).min(1),
    relevanceScores: z.record(z.number()).optional(),
  })).min(1),
});

const ExperimentBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  controlStrategy: z.enum(RETRIEVAL_STRATEGIES),
  treatmentStrategy: z.enum(RETRIEVAL_STRATEGIES),
  testSetId: z.string().uuid().optional(),
  trafficPct: z.number().int().min(0).max(100).optional().default(10),
});

const RecordResultBodySchema = z.object({
  strategyName: z.string().min(1),
  retrievedIds: z.array(z.string()),
  expectedIds: z.array(z.string()),
  k: z.number().int().min(1).optional().default(5),
  relevanceScores: z.record(z.number()).optional(),
});

const PromoteBodySchema = z.object({
  workspaceId: z.string().min(1),
  winner: z.enum(RETRIEVAL_STRATEGIES),
});

const EvaluateBodySchema = z.object({
  retrievedIds: z.array(z.string()).min(1),
  expectedIds: z.array(z.string()).min(1),
  k: z.number().int().min(1).optional().default(5),
  relevanceScores: z.record(z.number()).optional(),
});

/**
 * Creates the search quality evaluation router.
 * @param sql - Postgres client instance
 * @returns Hono router
 */
export function makeSearchQualityRouter(sql: ReturnType<typeof postgres>) {
  const router = new Hono();
  const svc = new SearchQualityEvaluator(sql);

  router.post('/evaluate', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = EvaluateBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const { retrievedIds, expectedIds, k, relevanceScores } = parsed.data;
    const metrics = computeMetrics(retrievedIds, expectedIds, k, relevanceScores ?? undefined);
    return c.json({ data: metrics });
  });

  router.post('/test-sets', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = TestSetBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const { workspaceId, name, description, queries } = parsed.data;
    const result = await svc.defineTestSet(workspaceId, name, queries as Parameters<typeof svc.defineTestSet>[2], description);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  router.post('/experiments', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ExperimentBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const { workspaceId, name, controlStrategy, treatmentStrategy, testSetId, trafficPct } = parsed.data;
    const result = await svc.createExperiment(workspaceId, name, controlStrategy, treatmentStrategy, testSetId, trafficPct);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  router.get('/experiments', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? '';
    if (!workspaceId) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    const status = c.req.query('status') as Parameters<typeof svc.listExperiments>[1] | undefined;
    const result = await svc.listExperiments(workspaceId, status);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.post('/experiments/:id/results', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json().catch(() => null);
    const parsed = RecordResultBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const { strategyName, retrievedIds, expectedIds, k, relevanceScores } = parsed.data;
    const metrics = computeMetrics(retrievedIds, expectedIds, k, relevanceScores ?? undefined);
    const result = await svc.recordResult(id, strategyName, metrics);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { recorded: true, metrics } });
  });

  router.get('/experiments/:id/results', async (c) => {
    const { id } = c.req.param();
    const result = await svc.getResults(id);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    const rows = result.value;
    if (rows.length < 2) return c.json({ data: { results: rows, comparison: null } });

    const control = rows.find((r) => r.strategyName === 'control');
    const treatment = rows.find((r) => r.strategyName === 'treatment');
    let comparison = null;
    if (control && treatment) {
      const controlData = await svc.listExperiments('', undefined);
      comparison = compareStrategies(
        { strategy: 'vector' as RetrievalStrategy, metrics: control.metrics },
        { strategy: 'hybrid' as RetrievalStrategy, metrics: treatment.metrics },
      );
    }
    return c.json({ data: { results: rows, comparison } });
  });

  router.post('/experiments/:id/promote', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json().catch(() => null);
    const parsed = PromoteBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.promoteExperiment(parsed.data.workspaceId, id, parsed.data.winner);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  return router;
}
