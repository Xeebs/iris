import { Hono } from 'hono';
import type postgres from 'postgres';

import { HybridSearchEngine, searchRequestSchema } from '@iris/semantic-core/hybrid-search-engine';

type SqlClient = ReturnType<typeof postgres>;

/**
 * REST routes for hybrid semantic + full-text entity search.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted at /search
 */
export function createSearchRoutes(sql: SqlClient) {
  const app = new Hono();

  /** POST /search — run a hybrid BM25 + semantic query */
  app.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'INVALID_JSON', message: 'Request body must be JSON' } }, 400);
    }

    const parsed = searchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message, details: parsed.error.issues },
      }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HybridSearchEngine(sql as unknown as any);
    const result = await engine.search(parsed.data);

    if (result.isErr()) {
      return c.json({ error: { code: 'SEARCH_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
