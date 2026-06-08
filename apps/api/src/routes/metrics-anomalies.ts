import { Hono } from 'hono';
import { z } from 'zod';

import { MetricsAnomalyDetector } from '@iris/semantic-core/metrics-anomaly-detector';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'metrics-anomalies' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
type SqlClient = SqlFn;

const detectQuerySchema = z.object({
  lookbackDays: z.coerce.number().int().min(1).max(365).optional().default(30),
  sensitivity: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});

const forecastQuerySchema = z.object({
  daysAhead: z.coerce.number().int().min(1).max(90).optional().default(7),
  alpha: z.coerce.number().min(0.01).max(0.99).optional().default(0.3),
});

const acknowledgeBodySchema = z.object({
  notes: z.string().max(500).optional(),
});

/**
 * Factory for metric anomaly detection and forecasting routes.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted under /metrics/:metricId/anomalies (and /forecasts)
 */
export function createMetricsAnomalyRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const detector = new MetricsAnomalyDetector(sql as unknown as ConstructorParameters<typeof MetricsAnomalyDetector>[0]);

  /** GET /api/v1/metrics/:metricId/anomalies — list anomalies for a metric */
  app.get('/:metricId/anomalies', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { metricId } = c.req.param();
    const includeAcknowledged = c.req.query('includeAcknowledged') === 'true';

    const result = await detector.listAnomalies(metricId, includeAcknowledged);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list anomalies' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/metrics/:metricId/anomalies/detect — trigger anomaly detection */
  app.post('/:metricId/anomalies/detect', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { metricId } = c.req.param();
    const query = detectQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: query.error.message } }, 400);
    }

    const result = await detector.detectAnomalies(
      metricId,
      query.data.lookbackDays,
      query.data.sensitivity
    );

    if (result.isErr()) {
      log.error('Anomaly detection failed', { metricId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Detection failed' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** POST /api/v1/metrics/:metricId/anomalies/:anomalyId/acknowledge — acknowledge anomaly */
  app.post('/:metricId/anomalies/:anomalyId/acknowledge', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { anomalyId } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const parsed = acknowledgeBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await detector.acknowledgeAnomaly(anomalyId, parsed.data.notes);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Acknowledge failed' } }, 500);
    }

    return c.json({ data: { acknowledged: true } });
  });

  /** GET /api/v1/metrics/:metricId/forecast — forecast future values */
  app.get('/:metricId/forecast', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { metricId } = c.req.param();
    const query = forecastQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: query.error.message } }, 400);
    }

    const result = await detector.forecastMetricValue(metricId, query.data.daysAhead, query.data.alpha);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Forecast failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** GET /api/v1/metrics/:metricId/anomalies/:anomalyId/context — get anomaly context */
  app.get('/:metricId/anomalies/:anomalyId/context', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { metricId, anomalyId } = c.req.param();
    const windowHours = Math.min(Number(c.req.query('windowHours') ?? 24), 168);

    const rows = await sql`
      SELECT anomaly_date FROM metric_anomalies WHERE anomaly_id = ${anomalyId}
    ` as unknown as { anomaly_date: string }[];

    if (rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Anomaly not found' } }, 404);
    }

    const timestamp = new Date(rows[0]!.anomaly_date);
    const result = await detector.anomalyContext(metricId, timestamp, windowHours);

    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Context fetch failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
