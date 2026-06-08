import { Hono } from 'hono';
import { z } from 'zod';
import {
  analyzeQueryPatterns,
  predictNextContext,
  preloadToCache,
  measurePrefixCacheHits,
} from '@iris/semantic-core/cache-prewarmer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'cache-prewarming' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const preloadSchema = z.object({
  workspaceId: z.string().min(1),
  entityIds: z.array(z.string()).min(1).max(100),
  ttlSeconds: z.number().int().min(30).max(3600).default(300),
});

const predictSchema = z.object({
  workspaceId: z.string().min(1),
  query: z.string().min(1),
  entityIds: z.array(z.string()).default([]),
});

/** @returns Hono router for cache prewarming endpoints */
export function createCachePrewarmingRoutes(sql: SqlFn) {
  const app = new Hono();

  // GET /api/v1/cache/prewarming-stats
  app.get('/prewarming-stats', async c => {
    const workspaceId = c.req.query('workspaceId');
    const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 90);

    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId required' } }, 400);
    }

    const result = await measurePrefixCacheHits(sql, workspaceId, days);
    if (result.isErr()) {
      log.error('Stats fetch failed', { error: result.error.message });
      return c.json({ error: { code: 'FETCH_FAILED', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  // GET /api/v1/cache/patterns
  app.get('/patterns', async c => {
    const workspaceId = c.req.query('workspaceId');
    const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 90);

    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId required' } }, 400);
    }

    const result = await analyzeQueryPatterns(sql, workspaceId, days);
    if (result.isErr()) {
      return c.json({ error: { code: 'ANALYZE_FAILED', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  // POST /api/v1/cache/preload
  app.post('/preload', async c => {
    const raw = await c.req.json().catch(() => ({})) as unknown;
    const parsed = preloadSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, entityIds, ttlSeconds } = parsed.data;
    const result = await preloadToCache(sql, workspaceId, entityIds, ttlSeconds);
    if (result.isErr()) {
      log.error('Preload failed', { error: result.error.message });
      return c.json({ error: { code: 'PRELOAD_FAILED', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  // POST /api/v1/cache/predict
  app.post('/predict', async c => {
    const raw = await c.req.json().catch(() => ({})) as unknown;
    const parsed = predictSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, query, entityIds } = parsed.data;
    const result = await predictNextContext(sql, workspaceId, query, entityIds);
    if (result.isErr()) {
      return c.json({ error: { code: 'PREDICT_FAILED', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
