import { Hono } from 'hono';
import { logger } from '@iris/core/logger';
import { CircuitBreakerService } from '@iris/semantic-core/circuit-breaker';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'circuit-breaker-admin' });

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createCircuitBreakerAdminRoutes(sql: Sql): Hono {
  const router = new Hono();
  const service = new CircuitBreakerService(sql as never);

  /** GET /admin/connectors/:connectorId/circuit-status */
  router.get('/:connectorId/circuit-status', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const connectorId = c.req.param('connectorId');

    const result = await service.getStatus(connectorId, workspaceId);
    if (result.isErr()) {
      log.error('Failed to get circuit status', { connectorId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /admin/connectors/:connectorId/circuit-reset */
  router.post('/:connectorId/circuit-reset', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const connectorId = c.req.param('connectorId');

    const result = await service.resetCircuit(connectorId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    log.info('Circuit manually reset via admin API', { connectorId, workspaceId });
    return c.json({ data: { connectorId, message: 'Circuit reset to CLOSED' } });
  });

  /** GET /admin/connectors/circuit-summary — list all circuit states for a workspace */
  router.get('/circuit-summary', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    try {
      type Row = {
        connector_id: string;
        state: string;
        fail_count: number;
        last_failure_at: string | null;
        opened_at: string | null;
        updated_at: string;
      };

      const rows = await sql<Row[]>`
        SELECT connector_id, state, fail_count, last_failure_at, opened_at, updated_at
        FROM circuit_breaker_state
        WHERE workspace_id = ${workspaceId}
        ORDER BY updated_at DESC
      `;
      return c.json({ data: rows });
    } catch (e) {
      log.error('Failed to fetch circuit summary', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch circuit summary' } }, 500);
    }
  });

  return router;
}
