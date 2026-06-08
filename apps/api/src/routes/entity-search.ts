import { Hono } from 'hono';
import { z } from 'zod';
import { EntitySearchEngine } from '@iris/semantic-core/entity-search';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ route: 'entity-search' });

const searchSchema = z.object({
  query: z.string().default(''),
  filters: z.string().default(''),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/**
 * @param sql - Tagged template SQL function
 * @returns Hono router for entity search endpoints
 */
export function createEntitySearchRoutes(sql: SqlFn) {
  const app = new Hono();
  const engine = new EntitySearchEngine(sql);

  // POST /entities/search — search entities with query + filters
  app.post('/entities/search', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => ({})) as unknown;
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' } }, 400);
    }
    const { query, filters, limit, cursor } = parsed.data;
    const result = await engine.searchEntities(workspaceId, query, filters, limit, cursor);
    if (result.isErr()) {
      log.error('Entity search failed', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'SEARCH_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // GET /entities/search-suggestions — filter auto-complete
  app.get('/entities/search-suggestions', async (c) => {
    const partial = c.req.query('q') ?? '';
    const result = await engine.suggestFilters(partial);
    if (result.isErr()) {
      return c.json({ error: { code: 'SUGGESTIONS_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
