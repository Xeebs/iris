import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { NlpConfigEngine, parseConfigIntent, generateConfigDiff } from '@iris/semantic-core/nlp-config-engine';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'nlp-config' });

type SqlClient = ReturnType<typeof postgres>;

const parseSchema = z.object({ text: z.string().min(1).max(2000) });
const confirmSchema = z.object({ userId: z.string().min(1) });

/**
 * Routes for NLP-driven workspace configuration.
 * All intents require explicit user confirmation before being applied.
 *
 * @param sql - Postgres client
 */
export function createNlpConfigRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const engine = new NlpConfigEngine(sql);

  /** POST /api/v1/nlp-config/parse — parse intent without saving */
  routes.post('/parse', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const body = parseSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'text is required' } }, 400);

    const intentResult = parseConfigIntent(body.data.text);
    if (intentResult.isErr()) return c.json({ error: { code: 'UNRECOGNIZED_INTENT', message: intentResult.error.message } }, 422);

    const diff = generateConfigDiff(intentResult.value);
    return c.json({ data: { intent: intentResult.value, diff } });
  });

  /** POST /api/v1/nlp-config/intents — parse and persist a pending intent */
  routes.post('/intents', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const body = parseSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'text is required' } }, 400);

    const result = await engine.parseAndSave(workspaceId, body.data.text);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.startsWith('Could not parse')) return c.json({ error: { code: 'UNRECOGNIZED_INTENT', message: msg } }, 422);
      log.error('Failed to save intent', { workspaceId, error: msg });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/nlp-config/intents — list pending intents */
  routes.get('/intents', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await engine.listPending(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /api/v1/nlp-config/intents/:id/apply — confirm and apply a pending intent */
  routes.post('/intents/:id/apply', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const body = confirmSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'userId is required' } }, 400);

    const result = await engine.applyIntent(workspaceId, c.req.param('id'), body.data.userId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    if (!result.value) return c.json({ error: { code: 'NOT_FOUND', message: 'Intent not found or already applied' } }, 404);
    return c.json({ data: result.value });
  });

  /** DELETE /api/v1/nlp-config/intents/:id — dismiss a pending intent */
  routes.delete('/intents/:id', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await engine.dismissIntent(workspaceId, c.req.param('id'));
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    if (!result.value) return c.json({ error: { code: 'NOT_FOUND', message: 'Intent not found or already applied' } }, 404);
    return c.json({ data: { dismissed: true } });
  });

  return routes;
}
