import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { EntityDuplicateMatcher } from '@iris/semantic-core';
import type { VectorStore } from '@iris/semantic-core';

const log = logger.child({ route: 'admin-dedup' });

type SqlClient = ReturnType<typeof postgres>;

const analyzeQuerySchema = z.object({
  entityType: z.string().optional(),
  threshold: z.coerce.number().min(0).max(1).default(0.60),
  topK: z.coerce.number().int().min(1).max(20).default(5),
});

const mergeBodySchema = z.object({
  mergedBy: z.string().min(1).default('admin'),
  signals: z.object({
    nameSimilarity: z.number(),
    emailDomainMatch: z.boolean(),
    embeddingSimilarity: z.number(),
    compositeScore: z.number(),
  }),
});

/**
 * @param sql - Postgres client
 * @param vectorStore - Vector store for entity retrieval
 * @returns Hono router mounted at /admin/dedup
 */
export function createAdminDedupRoutes(
  sql: SqlClient,
  vectorStore: VectorStore,
): Hono {
  const app = new Hono();
  const matcher = new EntityDuplicateMatcher(vectorStore, sql);

  app.post('/analyze', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const parsed = analyzeQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { entityType, threshold, topK } = parsed.data;

    const analyzeOpts = {
      ...(entityType ? { entityType } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      ...(topK !== undefined ? { topK } : {}),
    };
    const result = await matcher.analyze(workspaceId, analyzeOpts);

    if (result.isErr()) {
      log.error('Deduplication analysis failed', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Analysis failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  app.post('/merge/:canonicalId/:duplicateId', async (c) => {
    const canonicalId = c.req.param('canonicalId');
    const duplicateId = c.req.param('duplicateId');
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    let body: z.infer<typeof mergeBodySchema>;
    try {
      const raw = await c.req.json() as unknown;
      const parsed = mergeBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
      }
      body = parsed.data;
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400);
    }

    const result = await matcher.merge(workspaceId, canonicalId, duplicateId, body.signals, body.mergedBy);

    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('duplicate key') || msg.includes('conflict')) {
        return c.json({ error: { code: 'CONFLICT', message: 'Link already exists' } }, 409);
      }
      log.error('Merge failed', { workspaceId, canonicalId, duplicateId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Merge failed' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  return app;
}
