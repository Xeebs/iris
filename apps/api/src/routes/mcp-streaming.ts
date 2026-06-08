import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { StreamingContextServer, encodeSSEError, encodeSSEDone } from '@iris/semantic-core/streaming-context';
import type { SemanticEntity } from '@iris/connector-sdk';

const log = logger.child({ service: 'mcp-streaming' });

const StreamRequestBody = z.object({
  entities: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      label: z.string(),
      attributes: z.record(z.unknown()),
      relationships: z.array(z.object({ type: z.string(), targetId: z.string() })),
      lastModified: z.string().datetime(),
      sourceId: z.string(),
    }),
  ).min(1),
  maxTokensPerChunk: z.number().int().min(100).max(8000).default(1500),
});

/**
 * @returns Hono router exposing POST /mcp/stream for SSE entity streaming
 */
export function createMcpStreamingRoutes(): Hono {
  const router = new Hono();
  const server = new StreamingContextServer();

  router.post('/stream', async (c) => {
    const parsed = StreamRequestBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.format() } }, 400);
    }

    const { entities: rawEntities, maxTokensPerChunk } = parsed.data;
    const entities: SemanticEntity[] = rawEntities.map((e) => ({
      ...e,
      lastModified: new Date(e.lastModified),
    }));

    log.info('Starting entity stream', { entityCount: entities.length, maxTokensPerChunk });

    const customServer = new StreamingContextServer({ maxTokensPerChunk });

    const stream = new ReadableStream({
      start(controller) {
        try {
          for (const chunk of customServer.streamEntities(entities)) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          controller.enqueue(new TextEncoder().encode(encodeSSEDone()));
          controller.close();
        } catch (e) {
          const errorEvent = encodeSSEError(e instanceof Error ? e.message : String(e));
          controller.enqueue(new TextEncoder().encode(errorEvent));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  router.get('/stream/config', (c) => {
    return c.json({
      data: {
        defaultMaxTokensPerChunk: 1500,
        maxTokensPerChunkLimit: 8000,
        supportedFormats: ['text/event-stream'],
        note: 'POST to /api/v1/mcp/stream with {entities, maxTokensPerChunk} to receive SSE chunks.',
      },
    });
  });

  return router;
}
