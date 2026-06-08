import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { BillingMeter } from '@iris/semantic-core/billing-meter';
import { ConnectorCostAttributor } from '@iris/semantic-core/connector-cost-attribution';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'billing' });
type SqlClient = ReturnType<typeof postgres>;

/**
 * Routes for workspace billing and usage metering.
 * Mounted under /api/v1/billing.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
const connectorBreakdownSchema = z.object({
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
});

export function createBillingRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const meter = new BillingMeter(sql as ConstructorParameters<typeof BillingMeter>[0]);
  const costAttributor = new ConnectorCostAttributor(sql);

  /** GET /api/v1/billing/usage — current period usage and forecasted charges */
  app.get('/usage', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = now;

    const result = await meter.calculateCharges(workspaceId, periodStart, periodEnd);
    if (result.isErr()) {
      log.error('Failed to calculate charges', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve usage' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /api/v1/billing/tier — current billing tier */
  app.get('/tier', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const result = await meter.getWorkspaceTier(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve tier' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /api/v1/billing/periods — billing history */
  app.get('/periods', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const result = await meter.listPeriods(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list billing periods' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/billing/events — record a usage event (internal use) */
  app.post('/events', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    let body: { eventType: string; quantity?: number };
    try { body = await c.req.json() as typeof body; }
    catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400); }

    if (!body.eventType) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'eventType is required' } }, 400);
    }

    const result = await meter.recordUsage(
      workspaceId,
      body.eventType as Parameters<typeof meter.recordUsage>[1],
      body.quantity ?? 1,
    );
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to record usage' } }, 500);
    }
    return c.json({ data: { recorded: true } });
  });

  /** GET /api/v1/billing/connectors — cost breakdown per connector with ROI metrics */
  app.get('/connectors', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const parsed = connectorBreakdownSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const now = new Date();
    const periodStart = parsed.data.periodStart ?? new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodEnd = parsed.data.periodEnd ?? now;

    const result = await costAttributor.aggregateByConnector(workspaceId, periodStart, periodEnd);
    if (result.isErr()) {
      log.error('Failed to aggregate connector costs', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve connector costs' } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
