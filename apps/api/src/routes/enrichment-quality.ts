import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { EnrichmentQualityScorer } from '@iris/semantic-core/enrichment-quality-scorer';

const log = logger.child({ route: 'enrichment-quality' });

type SqlClient = ReturnType<typeof postgres>;

const feedbackSchema = z.object({
  sourceId: z.string().min(1),
  entityType: z.string().min(1),
  accuracyRating: z.number().min(0).max(1),
});

/**
 * @param sql - Postgres client
 * @returns Hono sub-app mounted at /api/v1/enrichment
 */
export function createEnrichmentQualityRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const scorer = new EnrichmentQualityScorer(
    sql as ConstructorParameters<typeof EnrichmentQualityScorer>[0],
  );

  // GET /enrichment/quality/:connectorId — per-entity-type completeness scores
  app.get('/quality/:connectorId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const connectorId = c.req.param('connectorId');
    const period = new URL(c.req.url).searchParams.get('period') ?? 'P7D';

    const result = await scorer.aggregateEnrichmentMetrics(connectorId, workspaceId, period);
    if (result.isErr()) {
      log.error('Failed to get quality metrics', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to aggregate metrics' } }, 500);
    }

    return c.json({ data: result.value });
  });

  // GET /enrichment/gaps — missing fields by frequency
  app.get('/gaps', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const params = new URL(c.req.url).searchParams;
    const entityType = params.get('entityType');
    const connectorId = params.get('connectorId');
    if (!entityType || !connectorId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'entityType and connectorId required' } }, 400);
    }

    const minNullRate = parseFloat(params.get('minNullRate') ?? '0.5');
    const result = await scorer.detectEnrichmentGaps(entityType, connectorId, workspaceId, minNullRate);
    if (result.isErr()) {
      log.error('Failed to detect gaps', { entityType, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to detect gaps' } }, 500);
    }

    return c.json({ data: result.value });
  });

  // GET /enrichment/sources/:sourceId/reliability — source accuracy + feedback
  app.get('/sources/:sourceId/reliability', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const sourceId = c.req.param('sourceId');
    const result = await scorer.getSourceReliability(sourceId, workspaceId);
    if (result.isErr()) {
      log.error('Failed to get source reliability', { sourceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get source reliability' } }, 500);
    }

    return c.json({ data: result.value });
  });

  // POST /enrichment/sources/feedback — submit source reliability feedback
  app.post('/sources/feedback', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    }

    const { sourceId, entityType, accuracyRating } = parsed.data;
    const result = await scorer.recordSourceFeedback(sourceId, workspaceId, entityType, accuracyRating);
    if (result.isErr()) {
      log.error('Failed to record feedback', { sourceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, result.error.code === 'VALIDATION_ERROR' ? 400 : 500);
    }

    return c.json({ data: { ok: true } }, 201);
  });

  // GET /enrichment/roi/:connectorId — ROI analysis
  app.get('/roi/:connectorId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);

    const connectorId = c.req.param('connectorId');
    const period = new URL(c.req.url).searchParams.get('period') ?? 'P7D';

    const result = await scorer.assessEnrichmentROI(connectorId, workspaceId, period);
    if (result.isErr()) {
      log.error('Failed to assess ROI', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to assess ROI' } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
