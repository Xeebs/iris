import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { SyncQualityMonitor } from '@iris/semantic-core/sync-quality-monitor';

const log = logger.child({ route: 'admin-sync-quality' });

type SqlClient = ReturnType<typeof postgres>;

const qualityQuerySchema = z.object({
  workspaceId: z.string().min(1),
  windowDays: z.coerce.number().int().positive().max(365).default(30),
});

const configureSchema = z.object({
  entityCountZscoreThreshold: z.number().positive().max(10).optional(),
  completenessDropThreshold: z.number().min(0).max(1).optional(),
});

/**
 * @param sql - Postgres client
 */
export function createAdminSyncQualityRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const monitor = new SyncQualityMonitor(sql);

  /** GET /api/v1/admin/connectors/:connectorId/quality?workspaceId=&windowDays= */
  routes.get('/:connectorId/quality', async (c) => {
    const { connectorId } = c.req.param();
    const parsed = qualityQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required', details: parsed.error.errors } },
        400,
      );
    }

    const { workspaceId, windowDays } = parsed.data;

    const [trendResult, anomalyResult] = await Promise.allSettled([
      monitor.trackDataQualityTrend(connectorId, workspaceId, windowDays),
      monitor.detectAnomalies(connectorId, workspaceId),
    ]);

    const trend =
      trendResult.status === 'fulfilled' && trendResult.value.isOk()
        ? trendResult.value._unsafeUnwrap()
        : null;

    const anomalies =
      anomalyResult.status === 'fulfilled' && anomalyResult.value.isOk()
        ? anomalyResult.value._unsafeUnwrap()
        : null;

    if (!trend || !anomalies) {
      log.error('Failed to fetch sync quality data', { connectorId, workspaceId });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch sync quality data' } }, 500);
    }

    return c.json({
      data: {
        trend,
        latestAnomalies: anomalies,
      },
    });
  });

  /** POST /api/v1/admin/connectors/:connectorId/quality/configure */
  routes.post('/:connectorId/quality/configure', async (c) => {
    const { connectorId } = c.req.param();
    const body = await c.req.json().catch(() => null);

    const workspaceIdRaw = c.req.query('workspaceId') ?? (body as Record<string, unknown> | null)?.workspaceId;
    if (!workspaceIdRaw || typeof workspaceIdRaw !== 'string') {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const parsed = configureSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid threshold values', details: parsed.error.errors } },
        400,
      );
    }

    const result = await monitor.configureThresholds(connectorId, workspaceIdRaw, parsed.data as Parameters<typeof monitor.configureThresholds>[2]);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: { connectorId, workspaceId: workspaceIdRaw, updated: true } });
  });

  return routes;
}
