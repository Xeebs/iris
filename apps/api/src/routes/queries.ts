import { Hono } from 'hono';
import { z } from 'zod';
import type { VectorStore } from '@iris/semantic-core';
import { retrieveContext } from '@iris/semantic-core';
import { compress } from '@iris/compression';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'queries' });

const queryBodySchema = z.object({
  query: z.string().min(1),
  workspaceId: z.string().min(1),
  contextBudget: z.number().int().positive().default(2000),
  topK: z.number().int().positive().max(50).default(10),
  entityTypes: z.array(z.string()).optional(),
});

/**
 * @param vectorStore - Initialized vector store
 * @param openAiKey   - OpenAI API key for query embedding
 */
export function createQueryRoutes(vectorStore: VectorStore, openAiKey: string): Hono {
  const routes = new Hono();

  /** POST /api/v1/queries — execute a semantic context query */
  routes.post('/', async (c) => {
    const parsed = queryBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.errors } },
        400,
      );
    }
    const { query, workspaceId, contextBudget, topK, entityTypes } = parsed.data;

    const start = Date.now();
    const result = await retrieveContext(query, vectorStore, {
      workspaceId,
      topK,
      entityTypes,
      expandRelationships: true,
      maxDepth: 1,
      openAiApiKey: openAiKey,
    });

    const compressed = compress(result.entities, { contextBudget, query });
    const durationMs = Date.now() - start;

    log.info('Query complete', {
      workspaceId,
      entityCount: compressed.entityCount,
      tokenCount: compressed.tokenCount,
      truncated: compressed.truncated,
      durationMs,
    });

    return c.json({
      data: {
        content: compressed.content,
        tokenCount: compressed.tokenCount,
        entityCount: compressed.entityCount,
        truncated: compressed.truncated,
        durationMs,
      },
    });
  });

  return routes;
}
