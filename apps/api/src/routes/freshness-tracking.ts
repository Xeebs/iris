import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { FreshnessTracker } from '@iris/semantic-core/freshness-tracker';

const log = logger.child({ route: 'freshness-tracking' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const freshnessMetricsQuerySchema = z.object({
  intervalDays: z.coerce.number().int().min(1).max(90).optional().default(7),
});

const slaUpsertSchema = z.object({
  connectorId: z.string().optional(),
  entityType: z.string().optional(),
  maxAgeSeconds: z.number().int().positive(),
  warningThresholdPct: z.number().min(0).max(100).optional().default(80),
});

const listStaleQuerySchema = z.object({
  connectorId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * @param sql - Postgres client
 * @returns Hono sub-app mounted at /api/v1/freshness
 */
export function createFreshnessTrackingRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const tracker = new FreshnessTracker(sql as ConstructorParameters<typeof FreshnessTracker>[0]);

  // GET /freshness/entities/:id — entity age + SLA status
  app.get('/entities/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const entityId = c.req.param('id');

    const result = await tracker.computeFreshness(entityId, workspaceId);
    if (result.isErr()) {
      const e = result.error;
      if (e.code === 'NOT_FOUND') {
        return c.json({ error: { code: 'NOT_FOUND', message: e.message } }, 404);
      }
      log.error('Failed to compute freshness', { entityId, workspaceId, error: e.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to compute freshness' } }, 500);
    }

    return c.json({ data: result.value });
  });

  // GET /freshness/metrics/:connectorId — freshness stats per connector
  app.get('/metrics/:connectorId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const connectorId = c.req.param('connectorId');
    const parsed = freshnessMetricsQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.flatten() } }, 400);
    }

    const result = await tracker.analyzeFreshnessMetrics(connectorId, workspaceId, parsed.data.intervalDays);
    if (result.isErr()) {
      log.error('Failed to analyze freshness', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to analyze freshness' } }, 500);
    }

    return c.json({ data: result.value });
  });

  // GET /freshness/stale — entities approaching or breaching SLA
  app.get('/stale', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const parsed = listStaleQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.flatten() } }, 400);
    }

    const result = await tracker.listStaleEntities(workspaceId, parsed.data.connectorId, parsed.data.limit);
    if (result.isErr()) {
      log.error('Failed to list stale entities', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list stale entities' } }, 500);
    }

    return c.json({ data: result.value, meta: { count: result.value.length } });
  });

  // GET /freshness/predict/:entityId — staleness prediction
  app.get('/predict/:entityId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const entityId = c.req.param('entityId');
    const connectorId = new URL(c.req.url).searchParams.get('connectorId');
    if (!connectorId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'connectorId query param required' } }, 400);
    }

    const result = await tracker.predictNextStaleEvent(entityId, connectorId, workspaceId);
    if (result.isErr()) {
      log.error('Failed to predict staleness', { entityId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to predict staleness' } }, 500);
    }

    return c.json({ data: result.value });
  });

  // GET /freshness/slas — workspace SLA config + compliance
  app.get('/slas', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    try {
      const slas = await sql<
        {
          id: number;
          connector_id: string | null;
          entity_type: string | null;
          max_age_seconds: number;
          warning_threshold_pct: number;
        }[]
      >`
        SELECT id, connector_id, entity_type, max_age_seconds, warning_threshold_pct
        FROM freshness_slas
        WHERE workspace_id = ${workspaceId}
        ORDER BY connector_id NULLS LAST, entity_type NULLS LAST
      `;

      return c.json({ data: slas });
    } catch (e) {
      log.error('Failed to fetch SLAs', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch SLAs' } }, 500);
    }
  });

  // POST /freshness/slas — upsert SLA config
  app.post('/slas', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = slaUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    }

    const { connectorId, entityType, maxAgeSeconds, warningThresholdPct } = parsed.data;

    try {
      await sql`
        INSERT INTO freshness_slas (workspace_id, connector_id, entity_type, max_age_seconds, warning_threshold_pct, updated_at)
        VALUES (${workspaceId}, ${connectorId ?? null}, ${entityType ?? null}, ${maxAgeSeconds}, ${warningThresholdPct}, NOW())
        ON CONFLICT (workspace_id, connector_id, entity_type) DO UPDATE SET
          max_age_seconds        = EXCLUDED.max_age_seconds,
          warning_threshold_pct  = EXCLUDED.warning_threshold_pct,
          updated_at             = EXCLUDED.updated_at
      `;

      return c.json({ data: { ok: true } }, 201);
    } catch (e) {
      log.error('Failed to upsert SLA', { workspaceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save SLA' } }, 500);
    }
  });

  return app;
}
