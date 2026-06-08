import { Hono } from 'hono';
import { z } from 'zod';
import { ConnectorHealthScorer } from '@iris/semantic-core/connector-health-scorer';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ route: 'connector-health' });

const recoveryActionSchema = z.object({
  actionType: z.enum(['re-auth', 'manual-sync', 'pause', 'retry']),
});

/**
 * @param sql - Tagged template SQL function
 * @returns Hono router for connector health endpoints
 */
export function createConnectorHealthRoutes(sql: SqlFn) {
  const app = new Hono();
  const scorer = new ConnectorHealthScorer(sql);

  // GET /:connectorId/health — score and return detailed breakdown
  app.get('/:connectorId/health', async (c) => {
    const connectorId = c.req.param('connectorId');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const result = await scorer.scoreConnector(connectorId, workspaceId);
    if (result.isErr()) {
      log.error('Health score failed', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'SCORE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // GET /:connectorId/health-history — time series of scores
  app.get('/:connectorId/health-history', async (c) => {
    const connectorId = c.req.param('connectorId');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const days = Math.min(30, Math.max(1, parseInt(c.req.query('days') ?? '7', 10)));
    const result = await scorer.getHealthHistory(connectorId, workspaceId, days);
    if (result.isErr()) {
      return c.json({ error: { code: 'HISTORY_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // POST /:connectorId/recovery-action — execute a recovery action
  app.post('/:connectorId/recovery-action', async (c) => {
    const connectorId = c.req.param('connectorId');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => null) as unknown;
    const parsed = recoveryActionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' } }, 400);
    }
    const result = await scorer.executeRecoveryAction(connectorId, workspaceId, parsed.data.actionType);
    if (result.isErr()) {
      return c.json({ error: { code: 'ACTION_FAILED', message: result.error.message } }, 500);
    }
    log.info('Recovery action executed', { connectorId, actionType: parsed.data.actionType });
    return c.json({ data: result.value }, 201);
  });

  // GET /health-alerts — list active alerts across workspace
  app.get('/health-alerts', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const result = await scorer.listActiveAlerts(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'ALERTS_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // DELETE /health-alerts/:alertId — resolve an alert
  app.delete('/health-alerts/:alertId', async (c) => {
    const alertId = c.req.param('alertId');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const result = await scorer.resolveAlert(alertId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'RESOLVE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { resolved: true } });
  });

  // GET /:connectorId/recovery-suggestions — recommend recovery actions
  app.get('/:connectorId/recovery-suggestions', async (c) => {
    const connectorId = c.req.param('connectorId');
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const result = await scorer.suggestRecovery(connectorId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'SUGGESTIONS_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
