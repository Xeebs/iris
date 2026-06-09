import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

const PrefetchSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  limit: z.number().int().positive().max(20).default(5),
});

const InvalidateSchema = z.object({
  workspaceId: z.string().min(1),
});

type CacheStatRow = {
  stat_id: string;
  workspace_id: string;
  query_hash: string;
  query_text: string | null;
  entity_type: string | null;
  total_requests: number;
  cache_hits: number;
  total_saved_tokens: number;
  last_hit_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type DependencyRow = {
  dep_id: string;
  query_hash: string;
  entity_id: string;
  created_at: Date;
};

type PatternRow = {
  query_hash: string;
  query_text: string;
  observed_at: Date;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for cache optimization endpoints
 */
export function createCacheOptimizationRoutes(sql: Sql) {
  const app = new Hono();

  // GET /cache/stats — hit rates per query/entity type
  app.get('/stats', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const entityType = c.req.query('entityType');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    try {
      let rows: CacheStatRow[];
      if (entityType) {
        rows = await sql`
          SELECT stat_id, workspace_id, query_hash, query_text, entity_type,
                 total_requests, cache_hits, total_saved_tokens, last_hit_at, created_at, updated_at
          FROM cache_statistics
          WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
          ORDER BY cache_hits DESC
          LIMIT ${limit}
        ` as CacheStatRow[];
      } else {
        rows = await sql`
          SELECT stat_id, workspace_id, query_hash, query_text, entity_type,
                 total_requests, cache_hits, total_saved_tokens, last_hit_at, created_at, updated_at
          FROM cache_statistics
          WHERE workspace_id = ${workspaceId}
          ORDER BY cache_hits DESC
          LIMIT ${limit}
        ` as CacheStatRow[];
      }

      const totalRequests = rows.reduce((s, r) => s + r.total_requests, 0);
      const totalHits = rows.reduce((s, r) => s + r.cache_hits, 0);
      const totalSavedTokens = rows.reduce((s, r) => s + r.total_saved_tokens, 0);

      return c.json({
        data: rows.map((r) => ({
          queryHash: r.query_hash,
          queryText: r.query_text,
          entityType: r.entity_type,
          totalRequests: r.total_requests,
          cacheHits: r.cache_hits,
          hitRate: r.total_requests > 0 ? r.cache_hits / r.total_requests : 0,
          totalSavedTokens: r.total_saved_tokens,
          lastHitAt: r.last_hit_at,
        })),
        meta: {
          totalEntries: rows.length,
          totalRequests,
          totalHits,
          overallHitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
          totalSavedTokens,
        },
      });
    } catch (err) {
      logger.error('Failed to fetch cache stats', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch cache statistics' } }, 500);
    }
  });

  // GET /cache/dependencies/:queryId — entity dependencies for a query
  app.get('/dependencies/:queryId', async (c) => {
    const queryHash = c.req.param('queryId');
    const workspaceId = c.req.query('workspaceId') ?? 'default';

    try {
      const rows = await sql`
        SELECT dep_id, query_hash, entity_id, created_at
        FROM query_dependencies
        WHERE query_hash = ${queryHash} AND workspace_id = ${workspaceId}
        ORDER BY created_at DESC
      ` as DependencyRow[];

      return c.json({
        data: {
          queryHash,
          dependencies: rows.map((r) => ({
            entityId: r.entity_id,
            createdAt: r.created_at,
          })),
        },
      });
    } catch (err) {
      logger.error('Failed to fetch dependencies', { queryHash, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch dependencies' } }, 500);
    }
  });

  // POST /cache/prefetch — trigger prefetch recommendations for a user
  app.post('/prefetch', zValidator('json', PrefetchSchema), async (c) => {
    const { workspaceId, userId, limit } = c.req.valid('json');

    try {
      // Fetch recent query patterns for this user
      const patterns = await sql`
        SELECT query_hash, query_text, observed_at
        FROM user_query_patterns
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
        ORDER BY observed_at DESC
        LIMIT 50
      ` as PatternRow[];

      // Count frequency
      const freq = new Map<string, { count: number; text: string }>();
      for (const p of patterns) {
        const e = freq.get(p.query_hash) ?? { count: 0, text: p.query_text };
        e.count++;
        freq.set(p.query_hash, e);
      }

      const recommendations = Array.from(freq.entries())
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, limit)
        .map(([queryHash, { count, text }]) => ({
          queryHash,
          queryText: text,
          confidence: Math.min(count / Math.max(1, patterns.length), 1),
          reason: `Appears ${count} time(s) in recent history for user ${userId}`,
        }));

      logger.info('Prefetch recommendations generated', { workspaceId, userId, recommendationCount: recommendations.length });

      return c.json({ data: { recommendations, userId, workspaceId } });
    } catch (err) {
      logger.error('Prefetch failed', { workspaceId, userId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'PREFETCH_FAILED', message: 'Failed to generate prefetch recommendations' } }, 500);
    }
  });

  // DELETE /cache/entries/:queryId — manual cache invalidation
  app.delete('/entries/:queryId', zValidator('json', InvalidateSchema), async (c) => {
    const queryHash = c.req.param('queryId');
    const { workspaceId } = c.req.valid('json');

    try {
      await sql`
        DELETE FROM query_dependencies
        WHERE query_hash = ${queryHash} AND workspace_id = ${workspaceId}
      `;

      logger.info('Cache entry manually invalidated', { queryHash, workspaceId });
      return c.json({ data: { queryHash, invalidated: true } });
    } catch (err) {
      logger.error('Manual invalidation failed', { queryHash, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'INVALIDATE_FAILED', message: 'Failed to invalidate cache entry' } }, 500);
    }
  });

  return app;
}
