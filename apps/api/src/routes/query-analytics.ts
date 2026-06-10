import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import {
  QueryAnalyticsEngine,
  computeQuerySignature,
  type AnalyticsStore,
  type QueryEvent,
  type QueryPattern,
  type CacheWarmingJob,
} from '@iris/semantic-core/query-analytics-engine';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'query-analytics' });
type SqlClient = ReturnType<typeof postgres>;

function buildStore(sql: SqlClient): AnalyticsStore {
  return {
    async recordEvent(event) {
      await sql`
        INSERT INTO query_events
          (query_id, workspace_id, user_id, query_text, query_signature, entity_types,
           cache_hit, latency_ms, tokens_spent, timestamp)
        VALUES (
          ${event.queryId},
          ${event.workspaceId}::uuid,
          ${event.userId ?? null},
          ${event.queryText},
          ${event.querySignature},
          ${event.entityTypes},
          ${event.cacheHit},
          ${event.latencyMs},
          ${event.tokensSpent},
          ${event.timestamp}
        )
        ON CONFLICT (query_id) DO NOTHING
      `;
    },

    async getRecentEvents(workspaceId, limitHours = 168) {
      const rows = await sql<QueryEvent[]>`
        SELECT
          query_id AS "queryId",
          workspace_id AS "workspaceId",
          user_id AS "userId",
          query_text AS "queryText",
          query_signature AS "querySignature",
          entity_types AS "entityTypes",
          cache_hit AS "cacheHit",
          latency_ms AS "latencyMs",
          tokens_spent AS "tokensSpent",
          timestamp
        FROM query_events
        WHERE workspace_id = ${workspaceId}::uuid
          AND timestamp > NOW() - (${limitHours} || ' hours')::INTERVAL
        ORDER BY timestamp DESC
        LIMIT 10000
      `;
      return rows;
    },

    async getPatterns(workspaceId) {
      const rows = await sql<
        { workspace_id: string; pattern_type: string; pattern_definition: unknown; confidence_score: string; discovered_at: Date }[]
      >`
        SELECT workspace_id, pattern_type, pattern_definition, confidence_score, discovered_at
        FROM query_patterns
        WHERE workspace_id = ${workspaceId}::uuid
        ORDER BY confidence_score DESC
      `;
      return rows.map((r) => ({
        workspaceId: r.workspace_id,
        patternType: r.pattern_type as QueryPattern['patternType'],
        definition: r.pattern_definition as QueryPattern['definition'],
        confidenceScore: Number(r.confidence_score),
        discoveredAt: r.discovered_at,
      }));
    },

    async savePattern(pattern) {
      await sql`
        INSERT INTO query_patterns (workspace_id, pattern_type, pattern_definition, confidence_score, discovered_at)
        VALUES (
          ${pattern.workspaceId}::uuid,
          ${pattern.patternType},
          ${sql.json(pattern.definition)},
          ${pattern.confidenceScore},
          ${pattern.discoveredAt}
        )
        ON CONFLICT (workspace_id, pattern_type, (pattern_definition->>'type')) DO UPDATE SET
          pattern_definition = EXCLUDED.pattern_definition,
          confidence_score = EXCLUDED.confidence_score,
          discovered_at = EXCLUDED.discovered_at
      `;
    },

    async recordWarmingJob(job) {
      await sql`
        INSERT INTO cache_warming_jobs
          (warming_job_id, workspace_id, trigger_query_signatures, executed_at, cache_hit_improvement_rate)
        VALUES (
          ${job.warmingJobId},
          ${job.workspaceId}::uuid,
          ${job.triggerQuerySignatures},
          ${job.executedAt},
          ${job.cacheHitImprovementRate ?? null}
        )
        ON CONFLICT (warming_job_id) DO NOTHING
      `;
    },

    async getTopSignatures(workspaceId, limit = 20) {
      const rows = await sql<{ signature: string; count: string; lastSeen: Date }[]>`
        SELECT
          query_signature AS signature,
          COUNT(*)::text AS count,
          MAX(timestamp) AS "lastSeen"
        FROM query_events
        WHERE workspace_id = ${workspaceId}::uuid
        GROUP BY query_signature
        ORDER BY count DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ signature: r.signature, count: Number(r.count), lastSeen: r.lastSeen }));
    },
  };
}

const trackQuerySchema = z.object({
  queryText: z.string().min(1).max(2000),
  cacheHit: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  tokensSpent: z.number().int().nonnegative().optional().default(0),
  userId: z.string().optional(),
});

/**
 * REST routes for query analytics: tracking, pattern discovery, cache warmup.
 * Base path: /api/v1/analytics/queries
 *
 * @param sql - Postgres client
 */
export function createQueryAnalyticsRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const getSvc = () => new QueryAnalyticsEngine(buildStore(sql));

  /** POST /analytics/queries/track — record a completed query */
  app.post('/track', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = trackQuerySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } }, 400);
    }

    const { queryText, cacheHit, latencyMs, tokensSpent, userId } = parsed.data;

    try {
      await getSvc().trackQuery(workspaceId, queryText, cacheHit, latencyMs, tokensSpent, userId);
      return c.json({ data: { tracked: true, signature: computeQuerySignature(queryText) } });
    } catch (e) {
      log.error('Failed to track query', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to track query' } }, 500);
    }
  });

  /** GET /analytics/queries — recent query history with patterns */
  app.get('/', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    const limitHours = Number(c.req.query('limitHours') ?? '168');

    try {
      const store = buildStore(sql);
      const [events, patterns, topSigs] = await Promise.all([
        store.getRecentEvents(workspaceId, limitHours),
        store.getPatterns(workspaceId),
        store.getTopSignatures(workspaceId, 20),
      ]);

      const cacheHitRate = events.length > 0
        ? events.filter((e) => e.cacheHit).length / events.length
        : 0;

      return c.json({
        data: {
          summary: {
            totalQueries: events.length,
            cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
            avgLatencyMs: events.length > 0
              ? Math.round(events.reduce((a, e) => a + e.latencyMs, 0) / events.length)
              : 0,
          },
          topSignatures: topSigs,
          patterns,
          recentEvents: events.slice(0, 100),
        },
      });
    } catch (e) {
      log.error('Failed to get query analytics', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get analytics' } }, 500);
    }
  });

  /** GET /analytics/queries/patterns — discovered patterns */
  app.get('/patterns', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    try {
      const patterns = await getSvc().getPatterns(workspaceId);
      return c.json({ data: patterns });
    } catch (e) {
      log.error('Failed to get patterns', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get patterns' } }, 500);
    }
  });

  /** POST /analytics/queries/detect-patterns — trigger pattern detection */
  app.post('/detect-patterns', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    try {
      const patterns = await getSvc().detectQueryPatterns(workspaceId);
      return c.json({ data: { patternsDetected: patterns.length, patterns } });
    } catch (e) {
      log.error('Failed to detect patterns', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to detect patterns' } }, 500);
    }
  });

  /** POST /analytics/cache-warming/trigger — trigger cache warming */
  app.post('/cache-warming/trigger', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    try {
      const svc = getSvc();
      const job = await svc.warmCache(workspaceId, async (_sig) => {
        // Warming is a no-op at the API layer; real warming is done by the MCP server.
      });
      return c.json({ data: { warmingJobId: job.warmingJobId, signaturesWarmed: job.triggerQuerySignatures.length } });
    } catch (e) {
      log.error('Failed to trigger cache warming', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to trigger warming' } }, 500);
    }
  });

  /** GET /analytics/queries/predict-cache-hit — predict cache hit probability */
  app.get('/predict-cache-hit', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }
    const query = c.req.query('q');
    if (!query) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'q param required' } }, 400);
    }

    try {
      const score = await getSvc().predictCacheHit(workspaceId, query);
      return c.json({ data: { query, signature: computeQuerySignature(query), hitProbability: score } });
    } catch (e) {
      log.error('Failed to predict cache hit', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to predict' } }, 500);
    }
  });

  return app;
}
