import { Hono } from 'hono';
import { z } from 'zod';
import { stream } from 'hono/streaming';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'streaming-context' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamedEntity {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
  relevanceScore: number;
  confidenceTier: 'high' | 'medium' | 'low';
  tokenEstimate: number;
  rank: number;
}

export interface StreamChunk {
  event: 'entity' | 'meta' | 'done' | 'error';
  data: StreamedEntity | StreamMetadata | StreamDone | StreamError;
}

export interface StreamMetadata {
  query: string;
  workspaceId: string;
  totalEstimatedTokens: number;
  startedAt: string;
}

export interface StreamDone {
  totalEntities: number;
  totalTokensUsed: number;
  durationMs: number;
  truncated: boolean;
}

export interface StreamError {
  code: string;
  message: string;
}

const streamRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  filters: z.object({
    entityTypes: z.array(z.string()).optional(),
    connectorIds: z.array(z.string()).optional(),
    dateRange: z.object({ from: z.string(), to: z.string() }).optional(),
  }).optional(),
  tokenBudget: z.number().int().min(100).max(16000).default(4000),
  limit: z.number().int().min(1).max(100).default(20),
});

// ─── Mock entity generator (replaced by real retrieval in production) ──────────

async function* fetchEntitiesProgressive(
  sql: SqlClient,
  workspaceId: string,
  query: string,
  filters: z.infer<typeof streamRequestSchema>['filters'],
  limit: number,
  signal: AbortSignal,
): AsyncGenerator<StreamedEntity> {
  try {
    const typeFilter = filters?.entityTypes && filters.entityTypes.length > 0
      ? filters.entityTypes
      : null;

    const connectorFilter = filters?.connectorIds && filters.connectorIds.length > 0
      ? filters.connectorIds
      : null;

    const rows = await sql<Array<{
      id: string;
      entity_type: string;
      label: string;
      attributes: Record<string, unknown>;
      source_connector_id: string | null;
      last_modified: string | null;
    }>>`
      SELECT id, entity_type, label, attributes, source_connector_id, last_modified
      FROM indexed_entities
      WHERE workspace_id = ${workspaceId}
        AND (${typeFilter} IS NULL OR entity_type = ANY(${typeFilter}))
        AND (${connectorFilter} IS NULL OR source_connector_id = ANY(${connectorFilter}))
        AND (
          label ILIKE ${'%' + query.split(' ').slice(0, 3).join('%') + '%'}
          OR attributes::text ILIKE ${'%' + query.split(' ')[0] + '%'}
        )
      ORDER BY last_modified DESC NULLS LAST
      LIMIT ${limit}
    `;

    let rank = 0;
    for (const row of rows) {
      if (signal.aborted) return;
      const score = Math.max(0, 1 - rank * 0.05);
      const tier: StreamedEntity['confidenceTier'] =
        score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low';
      yield {
        id: row.id,
        type: row.entity_type,
        label: row.label,
        attributes: row.attributes ?? {},
        relevanceScore: parseFloat(score.toFixed(3)),
        confidenceTier: tier,
        tokenEstimate: Math.ceil(JSON.stringify(row.attributes ?? {}).length / 4) + 20,
        rank: rank++,
      };
    }
  } catch (e) {
    if (!signal.aborted) throw e;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * Routes for streaming context responses via SSE.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createStreamingContextRoutes(sql: SqlClient) {
  const app = new Hono();

  /**
   * POST /context/stream — streams entity context as SSE events.
   * Each event is a JSON line with `event` and `data` fields.
   */
  app.post('/stream', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400);
    }

    const parsed = streamRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { query, filters, tokenBudget, limit } = parsed.data;
    const startedAt = Date.now();
    const controller = new AbortController();

    c.req.raw.signal?.addEventListener('abort', () => controller.abort());

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('X-Accel-Buffering', 'no');

    log.info('Streaming context request', { workspaceId, query: query.slice(0, 60), tokenBudget });

    return stream(c, async (s) => {
      let totalTokens = 0;
      let entityCount = 0;
      let truncated = false;

      const writeChunk = async (chunk: StreamChunk) => {
        await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      try {
        await writeChunk({
          event: 'meta',
          data: {
            query,
            workspaceId,
            totalEstimatedTokens: tokenBudget,
            startedAt: new Date(startedAt).toISOString(),
          },
        });

        const entities = fetchEntitiesProgressive(
          sql,
          workspaceId,
          query,
          filters,
          limit,
          controller.signal,
        );

        for await (const entity of entities) {
          if (controller.signal.aborted) break;
          if (totalTokens + entity.tokenEstimate > tokenBudget) {
            truncated = true;
            break;
          }
          totalTokens += entity.tokenEstimate;
          entityCount++;
          await writeChunk({ event: 'entity', data: entity });
        }

        await writeChunk({
          event: 'done',
          data: {
            totalEntities: entityCount,
            totalTokensUsed: totalTokens,
            durationMs: Date.now() - startedAt,
            truncated,
          },
        });

        log.info('Stream complete', { workspaceId, entityCount, totalTokens, durationMs: Date.now() - startedAt });
      } catch (e) {
        await writeChunk({
          event: 'error',
          data: { code: 'STREAM_ERROR', message: e instanceof Error ? e.message : 'Unknown error' },
        });
        log.error('Stream error', { workspaceId, error: e instanceof Error ? e.message : String(e) });
      }
    });
  });

  /**
   * GET /context/stream/metrics — aggregate streaming metrics for the dashboard.
   */
  app.get('/stream/metrics', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    try {
      const rows = await sql<Array<{
        avg_duration_ms: string;
        p95_duration_ms: string;
        avg_tokens: string;
        total_requests: string;
        truncation_rate: string;
      }>>`
        SELECT
          ROUND(AVG(duration_ms))::TEXT          AS avg_duration_ms,
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::TEXT AS p95_duration_ms,
          ROUND(AVG(tokens_used))::TEXT           AS avg_tokens,
          COUNT(*)::TEXT                          AS total_requests,
          ROUND(AVG(CASE WHEN truncated THEN 1 ELSE 0 END) * 100, 1)::TEXT AS truncation_rate
        FROM streaming_context_events
        WHERE workspace_id = ${workspaceId}
          AND created_at > NOW() - INTERVAL '24 hours'
      `;

      const row = rows[0];
      return c.json({
        data: {
          avgDurationMs: parseFloat(row?.avg_duration_ms ?? '0'),
          p95DurationMs: parseFloat(row?.p95_duration_ms ?? '0'),
          avgTokensPerRequest: parseFloat(row?.avg_tokens ?? '0'),
          totalRequests: parseInt(row?.total_requests ?? '0', 10),
          truncationRatePct: parseFloat(row?.truncation_rate ?? '0'),
        },
      });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'Unknown error' } }, 500);
    }
  });

  return app;
}
