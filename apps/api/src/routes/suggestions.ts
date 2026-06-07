import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { generateSuggestions, ProactiveSuggesterService } from '@iris/semantic-core/proactive-suggester';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'suggestions' });

type SqlClient = ReturnType<typeof postgres>;

const workspaceQuery = z.object({ workspaceId: z.string().min(1) });

const activityItemSchema = z.object({
  query: z.string().min(1),
  entityType: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

const suggestionsBodySchema = z.object({
  userId: z.string().min(1).default('system'),
  userRole: z.string().optional(),
  recentActivity: z.array(activityItemSchema).max(50).default([]),
  maxSuggestions: z.number().int().positive().max(10).default(3),
});

/**
 * @param sql - Postgres client
 */
export function createSuggestionsRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const service = new ProactiveSuggesterService(sql);

  /**
   * GET /api/v1/context-suggestions?workspaceId=&userId=
   * Returns saved suggestions for a workspace/user.
   */
  routes.get('/', async (c) => {
    const parsed = workspaceQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const userId = c.req.query('userId') ?? 'system';
    const result = await service.getRecentSuggestions(parsed.data.workspaceId, userId);
    if (result.isErr()) {
      log.error('Failed to get suggestions', { workspaceId: parsed.data.workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get suggestions' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /**
   * POST /api/v1/context-suggestions?workspaceId=
   * Generate and optionally persist suggestions based on recent activity.
   */
  routes.post('/', async (c) => {
    const workspaceParsed = workspaceQuery.safeParse(c.req.query());
    if (!workspaceParsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = suggestionsBodySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } },
        400,
      );
    }

    const { workspaceId } = workspaceParsed.data;
    const { userId, userRole, recentActivity, maxSuggestions } = body.data;

    const activity = recentActivity.map(a => ({
      query: a.query,
      ...(a.entityType !== undefined ? { entityType: a.entityType } : {}),
      timestamp: a.timestamp ? new Date(a.timestamp) : new Date(),
    }));

    const result = generateSuggestions(activity, userRole, maxSuggestions);

    const logResult = await service.logSuggestions(workspaceId, userId, result.suggestions);
    if (logResult.isErr()) {
      log.warn('Failed to log suggestions', { workspaceId, userId, error: logResult.error });
    }

    log.info('Suggestions generated', {
      workspaceId,
      userId,
      count: result.suggestions.length,
    });

    return c.json({ data: result });
  });

  /**
   * GET /api/v1/context-suggestions/co-occurrences?workspaceId=
   * Returns entity type co-occurrence patterns for analytical use.
   */
  routes.get('/co-occurrences', async (c) => {
    const parsed = workspaceQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const result = await service.getCoOccurrencePatterns(parsed.data.workspaceId);
    if (result.isErr()) {
      log.error('Failed to get co-occurrence patterns', { error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get co-occurrence patterns' } }, 500);
    }
    return c.json({ data: result.value });
  });

  return routes;
}
