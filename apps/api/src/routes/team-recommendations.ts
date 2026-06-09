import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { TeamContextRecommender } from '@iris/semantic-core/team-context-recommender';
import type { TeamUsageWindow } from '@iris/semantic-core/team-context-recommender';

const VALID_WINDOWS = new Set<string>(['7d', '30d', '90d']);

const PreferencesSchema = z.object({
  preferences: z.record(z.enum(['pin', 'dismiss'])),
});

const RecordAccessSchema = z.object({
  roleId: z.string().min(1),
  entityId: z.string().min(1),
  entityType: z.string().min(1),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/teams and /api/v1/roles
 */
export function makeTeamRecommendationsRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const svc = new TeamContextRecommender(sql);

  // GET /teams/:id/recommended-contexts
  app.get('/teams/:id/recommended-contexts', async (c) => {
    const teamId = c.req.param('id');
    const topK = Math.min(Number(c.req.query('topK') ?? 15), 50);
    const result = await svc.generateTeamRecommendations(teamId, topK);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // GET /teams/:id/usage
  app.get('/teams/:id/usage', async (c) => {
    const teamId = c.req.param('id');
    const windowParam = c.req.query('window') ?? '30d';
    const window: TeamUsageWindow = VALID_WINDOWS.has(windowParam) ? (windowParam as TeamUsageWindow) : '30d';
    const result = await svc.analyzeTeamContextUsage(teamId, window);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // GET /teams/:id/expansion-suggestions
  app.get('/teams/:id/expansion-suggestions', async (c) => {
    const teamId = c.req.param('id');
    const result = await svc.suggestContextExpansionForTeam(teamId);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // PUT /teams/:id/context-preferences
  app.put('/teams/:id/context-preferences', async (c) => {
    const teamId = c.req.param('id');
    const parsed = PreferencesSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await svc.saveContextPreferences(teamId, parsed.data.preferences);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: { updated: true } });
  });

  // POST /teams/:id/context-access
  app.post('/teams/:id/context-access', async (c) => {
    const teamId = c.req.param('id');
    const parsed = RecordAccessSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { roleId, entityId, entityType } = parsed.data;
    const result = await svc.recordContextAccess(teamId, roleId, entityId, entityType);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: { recorded: true } }, 201);
  });

  // GET /roles/:id/context-predictions
  app.get('/roles/:id/context-predictions', async (c) => {
    const roleId = c.req.param('id');
    const result = await svc.predictContextNeedsByRole(roleId);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return app;
}
