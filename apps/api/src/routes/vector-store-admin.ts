import { Hono } from 'hono';
import type postgres from 'postgres';
import { VectorStoreTuner } from '@iris/semantic-core/vector-store-tuner';

type SqlClient = ReturnType<typeof postgres>;

/**
 * REST routes for vector store health inspection and tuning.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted at /admin/vector-store
 */
export function createVectorStoreAdminRoutes(sql: SqlClient) {
  const app = new Hono();

  /** GET /health — analyse the iris_entities vector index */
  app.get('/health', async (c) => {
    const table = c.req.query('table') ?? 'iris_entities';
    const tuner = new VectorStoreTuner(sql);
    try {
      const report = await tuner.analyzeIndexHealth(table);
      const latencySla = parseInt(c.req.query('latencySla') ?? '50', 10);
      const strategy = tuner.recommendIndexStrategy(report.rowCount, latencySla);
      return c.json({ data: { health: report, recommendedStrategy: strategy } });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'Unknown error' } }, 500);
    }
  });

  /** POST /reindex — rebuild the vector index (admin only, slow operation) */
  app.post('/reindex', async (c) => {
    const raw = await c.req.json<unknown>().catch(() => ({}));
    const body = (raw != null && typeof raw === 'object' ? raw : {}) as { table?: unknown; lists?: unknown };
    const table = typeof body.table === 'string' ? body.table : 'iris_entities';
    const lists = typeof body.lists === 'number' ? body.lists : undefined;
    const tuner = new VectorStoreTuner(sql);
    try {
      await tuner.executeReindexing(table, lists);
      return c.json({ data: { message: `Reindex of ${table} complete` } });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'Unknown error' } }, 500);
    }
  });

  return app;
}
