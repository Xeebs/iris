import { Hono } from 'hono';
import { z } from 'zod';
import {
  classifyQueryComplexity,
  estimateTokenUsage,
  rankProvidersByValue,
  selectOptimalProvider,
  trackProviderAccuracy,
  getCostOptimizationStats,
  getProviderAccuracyBaselines,
  type LLMProvider,
} from '@iris/semantic-core/llm-cost-optimizer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'llm-cost-optimization' });

const EstimateCostSchema = z.object({
  query: z.string().min(1).max(10000),
  contextTokens: z.number().int().min(0).max(100000).default(500),
  provider: z.enum(['anthropic', 'openai', 'azure', 'gemini']).optional(),
  entityCount: z.number().int().min(1).optional(),
  relationshipDepth: z.number().int().min(1).optional(),
  maxCostCents: z.number().min(0).optional(),
  minAccuracy: z.number().min(0).max(1).optional(),
  maxLatencyMs: z.number().min(0).optional(),
});

const TrackAccuracySchema = z.object({
  queryHash: z.string().min(1).max(64),
  provider: z.enum(['anthropic', 'openai', 'azure', 'gemini']),
  actualTokens: z.number().int().min(0),
  actualCostCents: z.number().min(0),
  executionTimeMs: z.number().int().min(0),
  satisfactionScore: z.number().min(0).max(1).optional(),
});

export function createLlmCostOptimizationRoutes(sql: Parameters<typeof trackProviderAccuracy>[0]) {
  const app = new Hono();

  /** POST /llm-cost-optimization/estimate — estimate cost and pick optimal provider */
  app.post('/estimate', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = EstimateCostSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
    }

    const { query, contextTokens, provider, entityCount, relationshipDepth, maxCostCents, minAccuracy, maxLatencyMs } = parsed.data;

    const complexity = classifyQueryComplexity(query, { contextTokens, ...(entityCount !== undefined ? { entityCount } : {}), ...(relationshipDepth !== undefined ? { relationshipDepth } : {}) });

    if (provider) {
      const estimate = estimateTokenUsage(provider, query, contextTokens, complexity);
      return c.json({ data: { complexity, estimate } });
    }

    const selectionResult = selectOptimalProvider(query, contextTokens, maxCostCents, { ...(minAccuracy !== undefined ? { minAccuracy } : {}), ...(maxLatencyMs !== undefined ? { maxLatencyMs } : {}) });

    if (selectionResult.isErr()) {
      return c.json({ error: { code: 'NO_PROVIDER', message: selectionResult.error.message } }, 422);
    }

    const ranked = rankProvidersByValue(complexity, { ...(maxCostCents !== undefined ? { maxCostCents } : {}), ...(maxLatencyMs !== undefined ? { maxLatencyMs } : {}), ...(minAccuracy !== undefined ? { minAccuracy } : {}) });
    const allEstimates = (['anthropic', 'openai', 'azure', 'gemini'] as LLMProvider[]).map(p =>
      estimateTokenUsage(p, query, contextTokens, complexity)
    );

    return c.json({
      data: {
        complexity,
        optimal: selectionResult.value,
        ranked,
        allEstimates,
      },
    });
  });

  /** GET /llm-cost-optimization/recommendations — get provider rankings for a complexity level */
  app.get('/recommendations', async (c) => {
    const scoreStr = c.req.query('complexityScore');
    const maxCostStr = c.req.query('maxCostCents');
    const minAccuracyStr = c.req.query('minAccuracy');

    const score = scoreStr ? parseInt(scoreStr, 10) : 5;
    if (isNaN(score) || score < 1 || score > 10) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'complexityScore must be 1–10' } }, 400);
    }

    const complexity = {
      score,
      factors: {
        entityCount: 1,
        relationshipDepth: 1,
        contextSizeTokens: 500,
        requiresReasoning: score >= 7,
        requiresCodeGeneration: false,
      },
    };

    const requirements: Record<string, number> = {};
    if (maxCostStr) requirements['maxCostCents'] = parseFloat(maxCostStr);
    if (minAccuracyStr) requirements['minAccuracy'] = parseFloat(minAccuracyStr);

    const ranked = rankProvidersByValue(complexity, requirements);
    return c.json({ data: { ranked, complexity } });
  });

  /** GET /llm-cost-optimization/accuracy-baselines — get per-provider accuracy baselines */
  app.get('/accuracy-baselines', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    try {
      const result = await getProviderAccuracyBaselines(sql, workspaceId);
      if (result.isErr()) {
        log.error('Failed to get accuracy baselines', { error: result.error.message });
        return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load baselines' } }, 500);
      }
      return c.json({ data: result.value });
    } catch {
      return c.json({ data: [] });
    }
  });

  /** GET /llm-cost-optimization/stats — aggregated cost optimization stats */
  app.get('/stats', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const daysStr = c.req.query('days') ?? '30';
    const days = parseInt(daysStr, 10);
    if (isNaN(days) || days < 1 || days > 365) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'days must be 1–365' } }, 400);
    }

    try {
      const result = await getCostOptimizationStats(sql, workspaceId, days);
      if (result.isErr()) {
        log.error('Failed to get cost stats', { error: result.error.message });
        return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load stats' } }, 500);
      }
      return c.json({ data: result.value });
    } catch {
      return c.json({ data: null });
    }
  });

  /** POST /llm-cost-optimization/track — record actual cost and accuracy */
  app.post('/track', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const body = await c.req.json().catch(() => ({}));
    const parsed = TrackAccuracySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
    }

    const { queryHash, provider, actualTokens, actualCostCents, executionTimeMs, satisfactionScore } = parsed.data;

    try {
      const result = await trackProviderAccuracy(sql, workspaceId, queryHash, provider, actualTokens, actualCostCents, executionTimeMs, satisfactionScore);
      if (result.isErr()) {
        log.error('Failed to track accuracy', { error: result.error.message });
        return c.json({ error: { code: 'DB_ERROR', message: 'Failed to record tracking data' } }, 500);
      }
      return c.json({ data: { recorded: true } }, 201);
    } catch {
      return c.json({ data: { recorded: false } });
    }
  });

  return app;
}
