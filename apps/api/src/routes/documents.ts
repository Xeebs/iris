import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { DocumentIndexer } from '@iris/semantic-core/document-indexer';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'documents-routes' });

const SearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const BulkImportSchema = z.object({
  documents: z.array(
    z.object({
      sourceConnectorId: z.string().min(1),
      sourceEntityId: z.string().min(1),
      documentTitle: z.string(),
      contentPlaintext: z.string(),
    }),
  ).min(1).max(500),
});

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createDocumentsRoutes(sql: Sql): Hono {
  const router = new Hono();
  const indexer = new DocumentIndexer(sql as never);

  router.get('/search', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const parsed = SearchQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: parsed.error.format() } }, 400);
    }

    const { q, limit } = parsed.data;
    log.info('Document search', { workspaceId, q, limit });

    try {
      const results = await indexer.searchDocuments(workspaceId, q, limit);
      return c.json({ data: results, meta: { query: q, totalResults: results.length } });
    } catch (e) {
      log.error('Document search failed', { error: String(e) });
      return c.json({ error: { code: 'SEARCH_FAILED', message: String(e) } }, 500);
    }
  });

  router.get('/stats', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    try {
      const stats = await indexer.getIndexingStats(workspaceId);
      return c.json({ data: stats });
    } catch (e) {
      log.error('Document stats fetch failed', { error: String(e) });
      return c.json({ error: { code: 'FETCH_FAILED', message: String(e) } }, 500);
    }
  });

  router.post('/import/bulk', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const parsed = BulkImportSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.format() } }, 400);
    }

    const { documents } = parsed.data;
    let indexed = 0;
    let skipped = 0;

    for (const doc of documents) {
      try {
        const wrote = await indexer.indexDocument({ ...doc, workspaceId });
        if (wrote) indexed++; else skipped++;
      } catch (e) {
        log.warn('Failed to index document', { sourceEntityId: doc.sourceEntityId, error: String(e) });
        skipped++;
      }
    }

    log.info('Bulk import complete', { workspaceId, indexed, skipped });
    return c.json({ data: { indexed, skipped, total: documents.length } }, 201);
  });

  router.delete('/connector/:connectorId', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const connectorId = c.req.param('connectorId');

    try {
      const deleted = await indexer.deleteByConnector(workspaceId, connectorId);
      return c.json({ data: { deleted } });
    } catch (e) {
      log.error('Document deletion failed', { error: String(e) });
      return c.json({ error: { code: 'DELETE_FAILED', message: String(e) } }, 500);
    }
  });

  return router;
}
