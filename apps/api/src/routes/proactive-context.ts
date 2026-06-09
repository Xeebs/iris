import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { ProactiveContextEngine } from '@iris/semantic-core/proactive-context-engine';

type SqlClient = ReturnType<typeof postgres>;

const settingsSchema = z.object({
  aggressiveness: z.enum(['low', 'medium', 'high']),
  enabledEntityTypes: z.array(z.string()).min(0),
});

const feedbackSchema = z.object({
  feedback: z.enum(['accepted', 'ignored', 'modified']),
  feedbackScore: z.number().min(0).max(1).optional(),
});

const previewQuerySchema = z.object({
  currentContext: z.string().max(500).optional(),
});

/**
 * REST routes for proactive context surfacing and agent behavioral learning.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createProactiveContextRoutes(sql: SqlClient) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine = new ProactiveContextEngine(sql as unknown as any);

  const getWorkspaceId = (c: Context) =>
    (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');

  /** GET /agents/:agentId/proactive-preview — show what context would be suggested */
  app.get('/agents/:agentId/proactive-preview', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const params = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = previewQuerySchema.safeParse(params);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await engine.predictContext(
      workspaceId,
      c.req.param('agentId'),
      parsed.data.currentContext ?? '',
    );
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** GET /agents/:agentId/profile — view behavioral profile */
  app.get('/agents/:agentId/profile', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const result = await engine.getAgentProfile(workspaceId, c.req.param('agentId'));
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    if (!result.value) return c.json({ error: { code: 'NOT_FOUND', message: 'No behavioral profile found for this agent' } }, 404);
    return c.json({ data: result.value });
  });

  /** GET /agents/:agentId/acceptance-stats — suggestion acceptance rates */
  app.get('/agents/:agentId/acceptance-stats', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const result = await engine.getAcceptanceStats(workspaceId, c.req.param('agentId'));
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /agents/:agentId/proactive-settings — save tuning config */
  app.post('/agents/:agentId/proactive-settings', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await engine.saveSettings(
      workspaceId,
      c.req.param('agentId'),
      parsed.data.aggressiveness,
      parsed.data.enabledEntityTypes,
    );
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /proactive/feedback — record acceptance or ignore of a suggestion */
  app.post('/proactive/feedback', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const body = await c.req.json().catch(() => null) as { agentId?: string; suggestionId?: string } | null;
    if (!body?.agentId || !body?.suggestionId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'agentId and suggestionId are required' } }, 400);
    }

    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await engine.recordFeedback({
      workspaceId,
      agentId: body.agentId,
      suggestionId: body.suggestionId,
      feedback: parsed.data.feedback,
      ...(parsed.data.feedbackScore !== undefined ? { feedbackScore: parsed.data.feedbackScore } : {}),
    });
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { success: true } });
  });

  return app;
}
