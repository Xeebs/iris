import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { ContextSearcher } from '@iris/semantic-core/context-searcher';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'context-search-routes' });

const SearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().positive().max(50).default(10),
  workspaceId: z.string().min(1),
});

const searcher = new ContextSearcher();

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for MCP context search endpoints
 */
export function createContextSearchRoutes(sql: Sql) {
  const app = new Hono();

  // POST /mcp-responses/:responseId/search — search within a response context
  app.post('/:responseId/search', zValidator('json', SearchSchema), async (c) => {
    const responseId = c.req.param('responseId');
    const { query, limit, workspaceId } = c.req.valid('json');

    // Ensure response is indexed (fetch from DB if not in memory)
    if (!searcher.isIndexed(responseId)) {
      try {
        const rows = await sql`
          SELECT response_id, context_entities_json
          FROM mcp_response_cache
          WHERE response_id = ${responseId} AND workspace_id = ${workspaceId}
            AND expires_at > NOW()
          LIMIT 1
        ` as Array<{ response_id: string; context_entities_json: unknown[] }>;

        if (rows.length === 0) {
          return c.json({ error: { code: 'NOT_FOUND', message: 'Response context not found or expired' } }, 404);
        }

        searcher.indexMcpResponse(responseId, workspaceId, rows[0]!.context_entities_json as never);
      } catch (err) {
        log.error('Failed to load response context', { responseId, error: err instanceof Error ? err.message : String(err) });
        return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to load response context' } }, 500);
      }
    }

    const matches = searcher.searchWithinContext(responseId, query, limit);

    return c.json({
      data: {
        responseId,
        query,
        results: matches.map((m) => ({
          matchId: m.matchId,
          entityId: m.entity.id,
          entityType: m.entity.type,
          entityLabel: m.entity.label,
          score: m.score,
          matchingFields: m.matchingFields,
          rank: m.rank,
        })),
      },
      meta: { total: matches.length, query },
    });
  });

  return app;
}
