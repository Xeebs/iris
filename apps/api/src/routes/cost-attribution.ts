import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { CostAttributor } from '@iris/semantic-core/cost-attribution';

const PERIODS = ['day', 'week', 'month'] as const;

const AttributeBodySchema = z.object({
  queryId: z.string().min(1),
  entityId: z.string().min(1),
  tokensUsed: z.number().int().min(0),
  computeMs: z.number().int().min(0),
});

const ConnectorEventBodySchema = z.object({
  connectorId: z.string().min(1),
  apiCallCount: z.number().int().min(0),
  tokensIndexed: z.number().int().min(0),
  tokensRetrieved: z.number().int().min(0),
});

/**
 * Creates the cost attribution router.
 * @param sql - Postgres client instance
 * @returns Hono router
 */
export function makeCostAttributionRouter(sql: ReturnType<typeof postgres>) {
  const router = new Hono();
  const svc = new CostAttributor(sql);

  router.post('/attribute', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = AttributeBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const { queryId, entityId, tokensUsed, computeMs } = parsed.data;
    const result = await svc.attributeCostToEntity(queryId, entityId, tokensUsed, computeMs);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { attributed: true } });
  });

  router.get('/entities/:entityId', async (c) => {
    const { entityId } = c.req.param();
    const result = await svc.getEntityCostBreakdown(entityId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.get('/entities/:entityId/forecast', async (c) => {
    const { entityId } = c.req.param();
    const period = (c.req.query('interval') ?? 'month') as typeof PERIODS[number];
    if (!PERIODS.includes(period)) return c.json({ error: { code: 'VALIDATION_ERROR', message: `interval must be one of ${PERIODS.join(', ')}` } }, 400);
    const result = await svc.computeCostForecast(entityId, period);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.get('/connectors/:connectorId', async (c) => {
    const { connectorId } = c.req.param();
    const period = (c.req.query('period') ?? 'month') as typeof PERIODS[number];
    if (!PERIODS.includes(period)) return c.json({ error: { code: 'VALIDATION_ERROR', message: `period must be one of ${PERIODS.join(', ')}` } }, 400);
    const result = await svc.computeConnectorCost(connectorId, period);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.get('/users/:userId', async (c) => {
    const { userId } = c.req.param();
    const period = (c.req.query('period') ?? 'month') as typeof PERIODS[number];
    if (!PERIODS.includes(period)) return c.json({ error: { code: 'VALIDATION_ERROR', message: `period must be one of ${PERIODS.join(', ')}` } }, 400);
    const result = await svc.aggregateUserCosts(userId, period);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.post('/connector-events', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ConnectorEventBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const { connectorId, apiCallCount, tokensIndexed, tokensRetrieved } = parsed.data;
    const result = await svc.recordConnectorEvent(connectorId, apiCallCount, tokensIndexed, tokensRetrieved);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { recorded: true } });
  });

  return router;
}
