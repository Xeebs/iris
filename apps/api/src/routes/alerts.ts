import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { AlertsService } from '@iris/semantic-core/alerts';

const log = logger.child({ route: 'alerts' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createRuleSchema = z.object({
  name: z.string().min(1).max(100),
  condition: z.enum(['sync_failure', 'token_quota', 'performance_degradation', 'cache_miss_rate']),
  threshold: z.number().positive(),
  enabled: z.boolean().optional(),
});

const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['email', 'slack', 'pagerduty', 'webhook']),
  config: z.record(z.unknown()),
  isDefault: z.boolean().optional(),
});

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * @param sql - Postgres client
 * @returns Hono sub-app mounted at /workspace/alerts
 */
export function createAlertsRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const svc = new AlertsService(sql as ConstructorParameters<typeof AlertsService>[0]);

  // ─── Rules ─────────────────────────────────────────────────────────────────

  app.get('/rules', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const result = await svc.listRules(workspaceId);
    if (result.isErr()) {
      log.error('Failed to list rules', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list alert rules' } }, 500);
    }
    return c.json({ data: result.value });
  });

  app.post('/rules', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = createRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() } }, 400);
    }

    const opts: Parameters<typeof svc.createRule>[1] = {
      name: parsed.data.name,
      condition: parsed.data.condition,
      threshold: parsed.data.threshold,
    };
    if (parsed.data.enabled !== undefined) opts.enabled = parsed.data.enabled;

    const result = await svc.createRule(workspaceId, opts);
    if (result.isErr()) {
      log.error('Failed to create rule', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create alert rule' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  app.delete('/rules/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const ruleId = c.req.param('id');
    const result = await svc.deleteRule(workspaceId, ruleId);
    if (result.isErr()) {
      const status = result.error.message.includes('not found') ? 404 : 500;
      return c.json({ error: { code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', message: result.error.message } }, status);
    }
    return c.json({ data: { deleted: true } });
  });

  // ─── Channels ──────────────────────────────────────────────────────────────

  app.get('/channels', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const result = await svc.listChannels(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list channels' } }, 500);
    }
    return c.json({ data: result.value });
  });

  app.post('/channels', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = createChannelSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() } }, 400);
    }

    const opts: Parameters<typeof svc.createChannel>[1] = {
      name: parsed.data.name,
      type: parsed.data.type,
      config: parsed.data.config,
    };
    if (parsed.data.isDefault !== undefined) opts.isDefault = parsed.data.isDefault;

    const result = await svc.createChannel(workspaceId, opts);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create channel' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  app.delete('/channels/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const channelId = c.req.param('id');
    const result = await svc.deleteChannel(workspaceId, channelId);
    if (result.isErr()) {
      const status = result.error.message.includes('not found') ? 404 : 500;
      return c.json({ error: { code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', message: result.error.message } }, status);
    }
    return c.json({ data: { deleted: true } });
  });

  // ─── Evaluation & events ───────────────────────────────────────────────────

  app.post('/evaluate', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const result = await svc.evaluateRules(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { triggered: result.value } });
  });

  app.get('/events', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const result = await svc.listEvents(workspaceId, limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list events' } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
