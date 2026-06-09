import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';

import { logger } from '@iris/core/logger';
import { NlQueryGenerator } from '@iris/semantic-core/nl-query-generator';

const NlQueryBodySchema = z.object({
  question: z.string().min(1),
  contextBudget: z.number().int().positive().default(2000),
});

const FeedbackBodySchema = z.object({
  sessionId: z.string().min(1),
  helpful: z.boolean(),
  notes: z.string().max(1000).optional(),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for NL query generation
 */
export function createNlQueryGeneratorRoutes(sql: Sql) {
  const app = new Hono();
  const generator = new NlQueryGenerator(sql);

  /**
   * POST /queries/natural-language
   * Convert a natural language question to a context query plan.
   */
  app.post('/natural-language', zValidator('json', NlQueryBodySchema), async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const { question, contextBudget } = c.req.valid('json');

    try {
      const session = await generator.processNaturalLanguageQuery(question, workspaceId, contextBudget);

      logger.info('NL query generated via API', {
        sessionId: session.sessionId,
        workspaceId,
        intentType: session.intent.type,
      });

      return c.json({ data: session }, 200);
    } catch (e) {
      logger.error('Failed to process NL query', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to process query' } }, 500);
    }
  });

  /**
   * POST /queries/natural-language/feedback
   * Record user feedback for a query session.
   */
  app.post(
    '/natural-language/feedback',
    zValidator('json', FeedbackBodySchema),
    async (c) => {
      const { sessionId, helpful, notes } = c.req.valid('json');

      try {
        await generator.recordFeedback(sessionId, helpful, notes);
        return c.json({ data: { sessionId, recorded: true } });
      } catch (e) {
        logger.error('Failed to record NL query feedback', { sessionId, error: e });
        return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to record feedback' } }, 500);
      }
    }
  );

  /**
   * GET /queries/natural-language/history
   * Paginated session history for a workspace.
   */
  app.get('/natural-language/history', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const limit = Math.min(200, Number(c.req.query('limit') ?? '50'));
    const cursor = c.req.query('cursor');

    try {
      const { sessions, nextCursor } = await generator.getSessionHistory(workspaceId, limit, cursor);
      return c.json({ data: sessions, meta: { hasMore: nextCursor !== null, nextCursor } });
    } catch (e) {
      logger.error('Failed to fetch NL query history', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch history' } }, 500);
    }
  });

  /**
   * POST /queries/natural-language/classify
   * Classify intent only — no session persisted, no plan generated.
   */
  app.post(
    '/natural-language/classify',
    zValidator('json', z.object({ question: z.string().min(1) })),
    async (c) => {
      const { question } = c.req.valid('json');

      try {
        const intent = await generator.classifyQueryIntent(question);
        return c.json({ data: intent });
      } catch (e) {
        logger.error('Failed to classify NL query', { error: e });
        return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to classify query' } }, 500);
      }
    }
  );

  return app;
}
