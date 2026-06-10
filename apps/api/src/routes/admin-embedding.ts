import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { createEmbeddingProvider } from '@iris/semantic-core/embedding-provider';
import type { EmbeddingProviderConfig } from '@iris/semantic-core/embedding-provider';
import { getEmbeddingMetadata, reindexWorkspace } from '@iris/semantic-core/reindex-utils';
import type { ReindexOptions } from '@iris/semantic-core/reindex-utils';
import { PgvectorStore } from '@iris/semantic-core';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ route: 'admin-embedding' });

const MigrateBodySchema = z.object({
  workspaceId: z.string().min(1),
  provider: z.enum(['openai', 'azure', 'ollama', 'cohere']),
  modelId: z.string().optional(),
  apiKey: z.string().optional(),
  endpoint: z.string().optional(),
  dryRun: z.boolean().optional(),
});

/**
 * Create admin routes for embedding provider configuration and migration.
 *
 * @param sql - Postgres client for metadata persistence
 * @returns   - Hono router mounted at /admin/embedding-config
 */
export function createAdminEmbeddingRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /admin/embedding-config?workspaceId=xxx — return current provider metadata */
  app.get('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const meta = await getEmbeddingMetadata(sql, workspaceId);
    if (!meta) {
      return c.json({ data: null }, 200);
    }

    return c.json({ data: meta }, 200);
  });

  /** POST /admin/embedding-config/migrate — trigger embedding migration for a workspace */
  app.post('/migrate', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } }, 400);
    }

    const parsed = MigrateBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, provider, modelId, apiKey, endpoint, dryRun } = parsed.data;

    log.info('Embedding migration requested', { workspaceId, provider, modelId, dryRun });

    let embeddingProvider;
    try {
      const providerConfig: EmbeddingProviderConfig = { provider };
      if (modelId !== undefined) providerConfig.modelId = modelId;
      if (apiKey !== undefined) providerConfig.apiKey = apiKey;
      if (endpoint !== undefined) providerConfig.endpoint = endpoint;
      embeddingProvider = createEmbeddingProvider(providerConfig);
    } catch (e) {
      return c.json({
        error: {
          code: 'PROVIDER_CONFIG_ERROR',
          message: e instanceof Error ? e.message : 'Failed to initialize provider',
        },
      }, 422);
    }

    const pgUrl = process.env['DATABASE_URL'];
    if (!pgUrl) {
      return c.json({ error: { code: 'CONFIG_ERROR', message: 'DATABASE_URL not configured' } }, 500);
    }

    const vectorStore = new PgvectorStore(pgUrl, embeddingProvider.getModelDimensions());

    try {
      const reindexOpts: ReindexOptions = {};
      if (dryRun !== undefined) reindexOpts.dryRun = dryRun;
      const result = await reindexWorkspace(sql, vectorStore, workspaceId, embeddingProvider, reindexOpts);
      return c.json({ data: result }, 200);
    } catch (e) {
      log.error('Reindex failed', { workspaceId, error: e });
      return c.json({
        error: {
          code: 'REINDEX_FAILED',
          message: e instanceof Error ? e.message : 'Reindex failed',
        },
      }, 500);
    }
  });

  return app;
}
