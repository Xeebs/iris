import { Hono } from 'hono';
import { z } from 'zod';
import {
  suggestRelatedQueries,
  suggestMissingContext,
  recommendIndexExpansion,
  learnFromSuccessfulQueries,
} from '@iris/semantic-core/query-learning-engine';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ route: 'query-learning' });

const learnSchema = z.object({
  queryHistory: z.array(z.object({
    queryHash: z.string(),
    queryText: z.string(),
    entityTypesQueried: z.array(z.string()).default([]),
    filtersUsed: z.record(z.unknown()).default({}),
    resultCount: z.number().int().min(0).default(0),
    success: z.boolean(),
    executedAt: z.string().datetime(),
  })).min(1),
});

const suggestSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
});

const missingContextSchema = z.object({
  query: z.string().min(1),
  presentAttributes: z.array(z.string()).default([]),
});

/**
 * Create Hono routes for query learning and suggestion endpoints.
 * @param sql - Postgres client
 * @returns Hono app with query learning routes
 */
export function createQueryLearningRoutes(sql: SqlFn) {
  const app = new Hono();

  // POST /queries/learn — ingest query history and learn patterns
  app.post('/queries/learn', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => ({})) as unknown;
    const parsed = learnSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'queryHistory is required' } }, 400);
    }
    const history = parsed.data.queryHistory.map(e => ({
      ...e,
      executedAt: new Date(e.executedAt),
    }));
    const result = await learnFromSuccessfulQueries(sql, workspaceId, history);
    if (result.isErr()) {
      return c.json({ error: { code: 'LEARN_FAILED', message: result.error.message } }, 500);
    }
    log.info('Query learning complete', { workspaceId, patternsUpserted: result.value });
    return c.json({ data: { patternsUpserted: result.value } }, 201);
  });

  // POST /queries/suggestions — get related query suggestions
  app.post('/queries/suggestions', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => ({})) as unknown;
    const parsed = suggestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'query is required' } }, 400);
    }
    const result = await suggestRelatedQueries(sql, workspaceId, parsed.data.query, parsed.data.limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'SUGGEST_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // POST /queries/missing-context — identify missing attributes in query results
  app.post('/queries/missing-context', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => ({})) as unknown;
    const parsed = missingContextSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'query is required' } }, 400);
    }
    const result = await suggestMissingContext(sql, workspaceId, parsed.data.query, parsed.data.presentAttributes);
    if (result.isErr()) {
      return c.json({ error: { code: 'CONTEXT_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // GET /workspaces/:id/index-expansion-recommendations — connector onboarding suggestions
  app.get('/workspaces/:id/index-expansion-recommendations', async (c) => {
    const workspaceId = c.req.param('id');
    const result = await recommendIndexExpansion(sql, workspaceId);
    if (result.isErr()) {
      log.error('Failed to compute recommendations', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'RECOMMEND_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
