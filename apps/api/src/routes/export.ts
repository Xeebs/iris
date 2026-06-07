import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { exportToOSI } from '@iris/semantic-core/osi-exporter';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'export' });

type SqlClient = ReturnType<typeof postgres>;

const osiQuerySchema = z.object({
  workspaceId: z.string().min(1),
  entityTypes: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  includeGlossary: z.enum(['true', 'false']).optional(),
  includeMetrics: z.enum(['true', 'false']).optional(),
});

/**
 * @param sql - Postgres client for data queries
 */
export function createExportRoutes(sql: SqlClient): Hono {
  const routes = new Hono();

  /**
   * GET /api/v1/export/osi?workspaceId=&entityTypes=contact,deal&since=&until=&includeGlossary=true&includeMetrics=true
   * Returns the workspace index as an OSI (JSON-LD) document.
   */
  routes.get('/osi', async (c) => {
    const parsed = osiQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required', details: parsed.error.errors } },
        400,
      );
    }

    const {
      workspaceId,
      entityTypes: entityTypesRaw,
      since: sinceRaw,
      until: untilRaw,
      includeGlossary: includeGlossaryRaw,
      includeMetrics: includeMetricsRaw,
    } = parsed.data;

    const options = {
      entityTypes: entityTypesRaw ? entityTypesRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      since: sinceRaw ? new Date(sinceRaw) : undefined,
      until: untilRaw ? new Date(untilRaw) : undefined,
      includeGlossary: includeGlossaryRaw !== 'false',
      includeMetrics: includeMetricsRaw !== 'false',
    };

    const result = await exportToOSI(workspaceId, options, sql);

    if (result.isErr()) {
      log.error('OSI export failed', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Export failed' } }, 500);
    }

    const doc = result.value;
    log.info('OSI export served', { workspaceId, totalNodes: doc.totalNodes });

    return c.json({ data: doc });
  });

  return routes;
}
