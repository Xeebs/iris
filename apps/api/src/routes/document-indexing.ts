import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { DocumentIndexer } from '@iris/semantic-core/document-indexer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'document-indexing' });

type SqlClient = ReturnType<typeof postgres>;

/**
 * @param sql - Postgres client
 * @returns Hono router for document indexing management endpoints
 */
export function createDocumentIndexingRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const indexer = new DocumentIndexer(sql as unknown as ReturnType<typeof postgres>);

  /** GET /document-indexing/stats — per-connector document count and token stats */
  app.get('/stats', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    try {
      const stats = await indexer.getIndexingStats(workspaceId);
      return c.json({ data: stats });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to fetch document indexing stats', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch stats' } }, 500);
    }
  });

  const searchSchema = z.object({
    q: z.string().min(1).max(500),
    limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  });

  /** GET /document-indexing/search?q=... — full-text search across indexed documents */
  app.get('/search', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const parsed = searchSchema.safeParse({
      q: c.req.query('q'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    try {
      const excerpts = await indexer.searchDocuments(workspaceId, parsed.data.q, parsed.data.limit);
      return c.json({ data: excerpts });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Document search failed', { workspaceId, query: parsed.data.q, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Search failed' } }, 500);
    }
  });

  const deleteSchema = z.object({
    connectorInstanceId: z.string().min(1),
  });

  /** DELETE /document-indexing/connector/:id — remove all documents for a connector */
  app.delete('/connector/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const parsed = deleteSchema.safeParse({ connectorInstanceId: c.req.param('id') });
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    try {
      const deleted = await indexer.deleteByConnector(workspaceId, parsed.data.connectorInstanceId);
      log.info('Connector documents deleted', { workspaceId, connectorInstanceId: parsed.data.connectorInstanceId, deleted });
      return c.json({ data: { deleted } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to delete connector documents', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Delete failed' } }, 500);
    }
  });

  return app;
}
