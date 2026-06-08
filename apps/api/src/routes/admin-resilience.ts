import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { ConnectorResilienceManager } from '@iris/queue/connector-resilience';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'admin-resilience' });
type SqlClient = ReturnType<typeof postgres>;

const policyBodySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).optional(),
  backoffStrategy: z.enum(['exponential', 'linear', 'fibonacci']).optional(),
  baseDelayMs: z.number().int().min(100).max(60_000).optional(),
  maxDelayMs: z.number().int().min(100).max(300_000).optional(),
  jitterFactor: z.number().min(0).max(1).optional(),
  circuitBreakerThreshold: z.number().min(0.1).max(1).optional(),
  circuitCooldownMs: z.number().int().min(1_000).max(300_000).optional(),
  timeoutMs: z.number().int().min(500).max(300_000).optional(),
  maxConcurrent: z.number().int().min(1).max(100).optional(),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/admin/connectors/resilience
 */
export function createAdminResilienceRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const manager = new ConnectorResilienceManager(sql as ConstructorParameters<typeof ConnectorResilienceManager>[0]);

  /** GET /api/v1/admin/connectors/resilience — all connector metrics + policies */
  app.get('/', async (c) => {
    try {
      const allMetrics = manager.getAllMetrics();
      return c.json({ data: allMetrics });
    } catch (e) {
      log.error('Failed to get resilience metrics', { error: String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve resilience metrics' } }, 500);
    }
  });

  /** GET /api/v1/admin/connectors/resilience/:connectorId — single connector metrics + policy */
  app.get('/:connectorId', async (c) => {
    const connectorId = c.req.param('connectorId');
    try {
      const [metrics, policy] = await Promise.all([
        Promise.resolve(manager.getMetrics(connectorId)),
        manager.getPolicy(connectorId),
      ]);
      return c.json({ data: { metrics, policy } });
    } catch (e) {
      log.error('Failed to get connector resilience', { connectorId, error: String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve connector resilience' } }, 500);
    }
  });

  /** PUT /api/v1/admin/connectors/resilience/:connectorId — update policy */
  app.put('/:connectorId', async (c) => {
    const connectorId = c.req.param('connectorId');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400);
    }

    const parsed = policyBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid policy params', details: parsed.error.errors } }, 400);
    }

    try {
      const existing = await manager.getPolicy(connectorId);
      const updated = {
        ...existing,
        ...Object.fromEntries(
          Object.entries(parsed.data)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => {
              const snakeKey = k.replace(/([A-Z])/g, '_$1').toLowerCase();
              return [snakeKey, v];
            }),
        ),
        connectorId,
        // Re-map camelCase keys
        maxRetries: parsed.data.maxRetries ?? existing.maxRetries,
        backoffStrategy: parsed.data.backoffStrategy ?? existing.backoffStrategy,
        baseDelayMs: parsed.data.baseDelayMs ?? existing.baseDelayMs,
        maxDelayMs: parsed.data.maxDelayMs ?? existing.maxDelayMs,
        jitterFactor: parsed.data.jitterFactor ?? existing.jitterFactor,
        circuitBreakerThreshold: parsed.data.circuitBreakerThreshold ?? existing.circuitBreakerThreshold,
        circuitCooldownMs: parsed.data.circuitCooldownMs ?? existing.circuitCooldownMs,
        timeoutMs: parsed.data.timeoutMs ?? existing.timeoutMs,
        maxConcurrent: parsed.data.maxConcurrent ?? existing.maxConcurrent,
      };

      await manager.setPolicy(updated);
      log.info('Resilience policy updated', { connectorId });
      return c.json({ data: { updated: true, connectorId, policy: updated } });
    } catch (e) {
      log.error('Failed to update resilience policy', { connectorId, error: String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update policy' } }, 500);
    }
  });

  /** DELETE /api/v1/admin/connectors/resilience/:connectorId/reset — reset circuit + metrics */
  app.delete('/:connectorId/reset', (c) => {
    const connectorId = c.req.param('connectorId');
    manager.resetConnector(connectorId);
    log.info('Connector resilience reset', { connectorId });
    return c.json({ data: { reset: true, connectorId } });
  });

  return app;
}
