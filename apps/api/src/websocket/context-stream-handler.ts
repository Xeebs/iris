import { z } from 'zod';
import type postgres from 'postgres';
import type { IncomingMessage } from 'http';
import type { WebSocket, WebSocketServer, RawData } from 'ws';

import { logger } from '@iris/core/logger';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ service: 'ws-context-stream' });

// ─── Protocol schemas ─────────────────────────────────────────────────────────

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    requestId: z.string(),
    query: z.string().min(1).max(2000),
    tokenBudget: z.number().int().min(100).max(16000).default(4000),
    filters: z.object({
      entityTypes: z.array(z.string()).optional(),
      connectorIds: z.array(z.string()).optional(),
    }).optional(),
  }),
  z.object({
    type: z.literal('cancel'),
    requestId: z.string(),
  }),
  z.object({
    type: z.literal('ping'),
  }),
]);

type ClientMessage = z.infer<typeof clientMessageSchema>;

interface ServerMessage {
  type: 'entity' | 'meta' | 'done' | 'error' | 'pong';
  requestId?: string;
  data: unknown;
}

// ─── Per-connection state ─────────────────────────────────────────────────────

interface ActiveStream {
  requestId: string;
  controller: AbortController;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function* fetchEntities(
  sql: SqlClient,
  workspaceId: string,
  query: string,
  filters: Extract<ClientMessage, { type: 'subscribe' }>['filters'],
  signal: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const typeFilter =
    filters?.entityTypes && filters.entityTypes.length > 0 ? filters.entityTypes : null;
  const connectorFilter =
    filters?.connectorIds && filters.connectorIds.length > 0 ? filters.connectorIds : null;

  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT id, entity_type, label, attributes, source_connector_id, last_modified
    FROM indexed_entities
    WHERE workspace_id = ${workspaceId}
      ${typeFilter ? sql`AND entity_type = ANY(${typeFilter})` : sql``}
      ${connectorFilter ? sql`AND source_connector_id = ANY(${connectorFilter})` : sql``}
      AND (
        label ILIKE ${'%' + query.split(' ').slice(0, 3).join('%') + '%'}
        OR attributes::text ILIKE ${'%' + query.split(' ')[0] + '%'}
      )
    ORDER BY last_modified DESC NULLS LAST
    LIMIT 50
  `;

  let rank = 0;
  for (const row of rows) {
    if (signal.aborted) return;
    yield { ...row, rank: rank++ };
  }
}

function handleConnection(ws: WebSocket, req: IncomingMessage, sql: SqlClient): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const workspaceId = url.searchParams.get('workspaceId');
  const apiKey = url.searchParams.get('apiKey');

  if (!workspaceId || !apiKey) {
    ws.close(4001, 'Missing workspaceId or apiKey');
    return;
  }

  log.info('WS connection established', { workspaceId });

  const activeStreams = new Map<string, ActiveStream>();

  const cleanup = () => {
    for (const s of activeStreams.values()) s.controller.abort();
    activeStreams.clear();
  };

  ws.on('close', cleanup);
  ws.on('error', (err: Error) => {
    log.error('WS error', { workspaceId, error: err.message });
    cleanup();
  });

  ws.on('message', async (raw: RawData) => {
    let parsed: ClientMessage;
    try {
      const text = raw.toString();
      const json = JSON.parse(text) as unknown;
      const result = clientMessageSchema.safeParse(json);
      if (!result.success) {
        send(ws, { type: 'error', data: { code: 'PARSE_ERROR', message: result.error.message } });
        return;
      }
      parsed = result.data;
    } catch {
      send(ws, { type: 'error', data: { code: 'PARSE_ERROR', message: 'Invalid JSON' } });
      return;
    }

    if (parsed.type === 'ping') {
      send(ws, { type: 'pong', data: { ts: Date.now() } });
      return;
    }

    if (parsed.type === 'cancel') {
      activeStreams.get(parsed.requestId)?.controller.abort();
      activeStreams.delete(parsed.requestId);
      return;
    }

    // subscribe
    if (activeStreams.has(parsed.requestId)) {
      send(ws, {
        type: 'error',
        requestId: parsed.requestId,
        data: { code: 'DUPLICATE_REQUEST', message: 'requestId already active' },
      });
      return;
    }

    const controller = new AbortController();
    activeStreams.set(parsed.requestId, { requestId: parsed.requestId, controller });

    const { requestId, query, tokenBudget, filters } = parsed;
    const startedAt = Date.now();

    send(ws, {
      type: 'meta',
      requestId,
      data: { query, workspaceId, tokenBudget, startedAt: new Date(startedAt).toISOString() },
    });

    let totalTokens = 0;
    let entityCount = 0;
    let truncated = false;

    try {
      const entities = fetchEntities(sql, workspaceId, query, filters, controller.signal);

      for await (const row of entities) {
        if (!activeStreams.has(requestId) || controller.signal.aborted) break;

        const tokenEstimate =
          Math.ceil(JSON.stringify(row['attributes'] ?? {}).length / 4) + 20;

        if (totalTokens + tokenEstimate > tokenBudget) {
          truncated = true;
          break;
        }

        totalTokens += tokenEstimate;
        entityCount++;

        const rank = row['rank'] as number;
        const score = Math.max(0, 1 - rank * 0.05);
        const tier = score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low';

        send(ws, {
          type: 'entity',
          requestId,
          data: {
            id: row['id'],
            type: row['entity_type'],
            label: row['label'],
            attributes: row['attributes'] ?? {},
            relevanceScore: parseFloat(score.toFixed(3)),
            confidenceTier: tier,
            tokenEstimate,
            rank,
          },
        });
      }

      send(ws, {
        type: 'done',
        requestId,
        data: {
          totalEntities: entityCount,
          totalTokensUsed: totalTokens,
          durationMs: Date.now() - startedAt,
          truncated,
        },
      });

      log.info('WS stream complete', { workspaceId, requestId, entityCount, totalTokens });
    } catch (e) {
      if (!controller.signal.aborted) {
        send(ws, {
          type: 'error',
          requestId,
          data: { code: 'STREAM_ERROR', message: e instanceof Error ? e.message : 'Unknown error' },
        });
        log.error('WS stream error', {
          workspaceId,
          requestId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      activeStreams.delete(requestId);
    }
  });
}

/**
 * Attaches the context-stream WebSocket handler to a WebSocketServer.
 *
 * @param wss - A `ws` WebSocketServer already bound to the HTTP server
 * @param sql - Postgres client
 */
export function attachContextStreamHandler(wss: WebSocketServer, sql: SqlClient): void {
  wss.on('connection', (ws, req) => handleConnection(ws, req, sql));
  log.info('Context stream WebSocket handler attached');
}
