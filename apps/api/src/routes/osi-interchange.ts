import { Hono } from 'hono';
import { logger } from '@iris/core/logger';
import { OsiInterchangeService, parseOsiDocument } from '@iris/semantic-core/osi-interchange';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'osi-interchange' });

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createOsiInterchangeRoutes(sql: Sql): Hono {
  const router = new Hono();
  const service = new OsiInterchangeService(sql as never);

  /**
   * POST /api/v1/workspace/import/osi
   * Body: raw OSI JSON-LD document string in the request body (Content-Type: application/json)
   */
  router.post('/import/osi', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    let rawBody: string;
    try {
      const body: unknown = await c.req.json();
      rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    } catch {
      return c.json({ error: { code: 'PARSE_ERROR', message: 'Request body must be JSON' } }, 400);
    }

    const parseResult = parseOsiDocument(rawBody);
    if (parseResult.isErr()) {
      return c.json(
        { error: { code: 'INVALID_OSI_DOCUMENT', message: parseResult.error.message } },
        400,
      );
    }

    const doc = parseResult.value;
    log.info('Starting OSI import', { workspaceId, totalNodes: doc.totalNodes });

    const summary = await service.importFromOsi(workspaceId, doc);

    return c.json({ data: summary }, 200);
  });

  /**
   * GET /api/v1/workspace/export/osi/info
   * Returns metadata about the OSI export format supported.
   */
  router.get('/export/osi/info', (c) => {
    return c.json({
      data: {
        version: '1.0',
        contextUri: 'https://schema.iris.ai/v1/',
        supportedTypes: ['entity', 'glossary_term', 'metric'],
        exportEndpoint: 'GET /api/v1/export/osi',
        importEndpoint: 'POST /api/v1/workspace/import/osi',
        notes: 'Export produces JSON-LD with @context and @graph. Import is idempotent (upsert by ID).',
      },
    });
  });

  return router;
}
