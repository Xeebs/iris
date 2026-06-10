import { Hono } from 'hono';
import { z } from 'zod';
import {
  getClientContextState,
  resetClientState,
  getDeltaHistory,
} from '@iris/semantic-core/context-delta-streamer';

type SqlType = Parameters<typeof getClientContextState>[0];

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for MCP client context delta endpoints
 */
export function createContextDeltasRoutes(sql: SqlType): Hono {
  const app = new Hono();

  /**
   * GET /:clientId/state
   * Retrieve current context state for an MCP client.
   */
  app.get('/:clientId/state', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? '';
    const { clientId } = c.req.param();

    const result = await getClientContextState(sql, clientId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'FETCH_FAILED', message: result.error.message } }, 500);
    }

    const state = result.value;
    if (!state) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'No active context state for this client' } }, 404);
    }

    return c.json({ data: state });
  });

  /**
   * GET /:clientId/context-history
   * Retrieve delta delivery history for an MCP client (cursor-paginated).
   */
  app.get('/:clientId/context-history', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? '';
    const { clientId } = c.req.param();

    const parsed = HistoryQuerySchema.safeParse({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
    });
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { limit, cursor } = parsed.data;

    const result = await getDeltaHistory(sql, clientId, workspaceId, limit, cursor);
    if (result.isErr()) {
      return c.json({ error: { code: 'FETCH_FAILED', message: result.error.message } }, 500);
    }

    const { entries, nextCursor } = result.value;
    return c.json({ data: entries, meta: { nextCursor, hasMore: nextCursor !== null } });
  });

  /**
   * DELETE /:clientId/state
   * Reset context state (forces full context on next query).
   */
  app.delete('/:clientId/state', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? '';
    const { clientId } = c.req.param();

    const result = await resetClientState(sql, clientId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'RESET_FAILED', message: result.error.message } }, 500);
    }

    return c.json({ data: { reset: true, clientId } });
  });

  return app;
}

// Backward-compat named export for tests (tests mock all underlying functions)
export const contextDeltasRouter = createContextDeltasRoutes(undefined as unknown as SqlType);
