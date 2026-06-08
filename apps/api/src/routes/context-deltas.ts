import { Hono } from 'hono';
import { z } from 'zod';
import {
  getClientContextState,
  resetClientState,
  getDeltaHistory,
} from '@iris/semantic-core/context-delta-streamer';

type SqlBindings = { sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]> };

const app = new Hono<{ Bindings: SqlBindings }>();

/**
 * GET /mcp-clients/:clientId/state
 * Retrieve current context state for an MCP client.
 */
app.get('/:clientId/state', async (c) => {
  const sql = (c.env as SqlBindings | undefined)?.sql;
  const workspaceId = c.req.header('x-workspace-id') ?? '';
  const { clientId } = c.req.param();

  const result = await getClientContextState(
    sql as Parameters<typeof getClientContextState>[0],
    clientId,
    workspaceId,
  );
  if (result.isErr()) {
    return c.json({ error: { code: 'FETCH_FAILED', message: result.error.message } }, 500);
  }

  const state = result.value;
  if (!state) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No active context state for this client' } }, 404);
  }

  return c.json({ data: state });
});

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

/**
 * GET /mcp-clients/:clientId/context-history
 * Retrieve delta delivery history for an MCP client (cursor-paginated).
 */
app.get('/:clientId/context-history', async (c) => {
  const sql = (c.env as SqlBindings | undefined)?.sql;
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

  const result = await getDeltaHistory(
    sql as Parameters<typeof getDeltaHistory>[0],
    clientId,
    workspaceId,
    limit,
    cursor,
  );
  if (result.isErr()) {
    return c.json({ error: { code: 'FETCH_FAILED', message: result.error.message } }, 500);
  }

  const { entries, nextCursor } = result.value;
  return c.json({ data: entries, meta: { nextCursor, hasMore: nextCursor !== null } });
});

/**
 * DELETE /mcp-clients/:clientId/state
 * Reset context state (forces full context on next query).
 */
app.delete('/:clientId/state', async (c) => {
  const sql = (c.env as SqlBindings | undefined)?.sql;
  const workspaceId = c.req.header('x-workspace-id') ?? '';
  const { clientId } = c.req.param();

  const result = await resetClientState(
    sql as Parameters<typeof resetClientState>[0],
    clientId,
    workspaceId,
  );
  if (result.isErr()) {
    return c.json({ error: { code: 'RESET_FAILED', message: result.error.message } }, 500);
  }

  return c.json({ data: { reset: true, clientId } });
});

export { app as contextDeltasRouter };
