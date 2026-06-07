import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { DataQualityScorer } from '@iris/semantic-core/data-quality-scorer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'data-quality' });

type SqlClient = ReturnType<typeof postgres>;

const reportQuerySchema = z.object({
  entityType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/**
 * Factory for data quality report routes.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted under /data-quality
 */
export function createDataQualityRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const scorer = new DataQualityScorer(sql as ConstructorParameters<typeof DataQualityScorer>[0]);

  /** GET /api/v1/data-quality/report — fetch quality scores for the workspace */
  app.get('/report', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const query = reportQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: query.error.message } }, 400);
    }

    const result = await scorer.getReport(workspaceId, query.data.entityType, query.data.limit);
    if (result.isErr()) {
      log.error('Failed to fetch quality report', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve quality report' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** GET /api/v1/data-quality/entities/:entityId — single entity quality score */
  app.get('/entities/:entityId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { entityId } = c.req.param();

    const rows = await sql`
      SELECT * FROM entity_quality_metrics
      WHERE workspace_id = ${workspaceId} AND entity_id = ${entityId}
    ` as Record<string, unknown>[];

    if (rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Entity quality score not found' } }, 404);
    }

    const r = rows[0]!;
    return c.json({
      data: {
        entityId: r['entity_id'],
        entityType: r['entity_type'],
        completenessScore: r['completeness_score'],
        freshnessScore: r['freshness_score'],
        conformanceScore: r['conformance_score'],
        relationshipScore: r['relationship_score'],
        overallQualityScore: r['overall_quality_score'],
        issues: r['issues'],
        computedAt: r['computed_at'],
      },
    });
  });

  return app;
}
