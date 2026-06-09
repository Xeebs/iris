import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import {
  StreamingContextServer,
  encodeSSEDone,
  encodeSSEError,
  encodeSSEEvent,
} from '@iris/semantic-core/streaming-context';
import type { SemanticEntity } from '@iris/connector-sdk';

type SqlClient = ReturnType<typeof postgres>;

const streamParamsSchema = z.object({
  workspaceId: z.string().min(1),
  contextBudget: z.coerce.number().int().min(100).max(8000).optional().default(2000),
  entityTypes: z.string().optional(),
  chunkSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  maxTokensPerChunk: z.coerce.number().int().min(10).max(4000).optional().default(1500),
});

/**
 * REST routes for SSE-based streaming context delivery.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createStreamingQueryRoutes(sql: SqlClient) {
  const app = new Hono();

  /** GET /streaming-queries/stream — SSE stream of entity chunks for a workspace query */
  app.get('/stream', async (c) => {
    const raw = {
      workspaceId: c.req.query('workspaceId'),
      contextBudget: c.req.query('contextBudget'),
      entityTypes: c.req.query('entityTypes'),
      chunkSize: c.req.query('chunkSize'),
      maxTokensPerChunk: c.req.query('maxTokensPerChunk'),
    };

    const parsed = streamParamsSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, contextBudget, entityTypes, maxTokensPerChunk, chunkSize } = parsed.data;
    const entityTypeFilter = entityTypes?.split(',').map((t) => t.trim()) ?? [];

    const streamServer = new StreamingContextServer({
      maxTokensPerChunk,
      maxEntitiesPerChunk: chunkSize,
    });

    const startMs = performance.now();
    let streamId: string | null = null;

    try {
      const [session] = await sql<{ stream_id: string }[]>`
        INSERT INTO streaming_sessions (workspace_id, context_budget, entity_filters)
        VALUES (${workspaceId}, ${contextBudget}, ${entityTypeFilter})
        RETURNING stream_id
      `;
      streamId = session?.stream_id ?? null;
    } catch {
      // non-critical — continue streaming without session tracking
    }

    const entityRowsPromise = entityTypeFilter.length > 0
      ? sql<SemanticEntity[]>`
          SELECT id, type, label, attributes, relationships, last_modified AS "lastModified", source_id AS "sourceId"
          FROM semantic_entities
          WHERE workspace_id = ${workspaceId} AND type = ANY(${entityTypeFilter})
          LIMIT ${contextBudget}
        `
      : sql<SemanticEntity[]>`
          SELECT id, type, label, attributes, relationships, last_modified AS "lastModified", source_id AS "sourceId"
          FROM semantic_entities
          WHERE workspace_id = ${workspaceId}
          LIMIT ${contextBudget}
        `;
    const entityRows = await entityRowsPromise.catch(() => [] as SemanticEntity[]);

    let totalChunks = 0;
    let totalBytes = 0;
    let totalTokens = 0;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        try {
          for (const chunk of streamServer.streamEntities(entityRows)) {
            const sse = encodeSSEEvent(chunk);
            controller.enqueue(encoder.encode(sse));
            totalChunks++;
            totalBytes += sse.length;
            totalTokens += chunk.metadata.tokensInChunk;

            if (totalTokens >= contextBudget) {
              const truncated = encodeSSEEvent({
                metadata: { chunkIndex: totalChunks, moreChunks: false, totalCount: entityRows.length, tokensInChunk: 0 },
                entities: [],
              });
              controller.enqueue(encoder.encode(truncated));
              break;
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Stream error';
          controller.enqueue(encoder.encode(encodeSSEError(errorMsg)));
        } finally {
          controller.enqueue(encoder.encode(encodeSSEDone()));
          controller.close();
        }
      },
    });

    const durationMs = Math.round(performance.now() - startMs);
    if (streamId) {
      void sql`
        UPDATE streaming_sessions
        SET status = 'completed', total_chunks = ${totalChunks}, total_bytes = ${totalBytes},
            total_tokens = ${totalTokens}, latency_p95_ms = ${durationMs}, closed_at = NOW()
        WHERE stream_id = ${streamId}
      `.catch(() => undefined);
    }

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Stream-Id': streamId ?? '',
      },
    });
  });

  /** GET /streaming-queries/sessions/:streamId — fetch session metadata */
  app.get('/sessions/:streamId', async (c) => {
    const streamId = c.req.param('streamId');
    try {
      const [session] = await sql<{
        stream_id: string;
        workspace_id: string;
        status: string;
        total_chunks: number;
        total_bytes: number;
        total_tokens: number;
        latency_p95_ms: number | null;
        started_at: Date;
        closed_at: Date | null;
      }[]>`SELECT * FROM streaming_sessions WHERE stream_id = ${streamId}`;
      if (!session) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Stream session not found' } }, 404);
      }
      return c.json({ data: session });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'DB error' } }, 500);
    }
  });

  return app;
}
