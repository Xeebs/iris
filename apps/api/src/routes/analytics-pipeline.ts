import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { AnalyticsService } from '@iris/semantic-core/analytics-engine';
import type { AggregateWindow, DashboardTemplate } from '@iris/semantic-core/analytics-engine';

const RecordEventSchema = z.object({
  name: z.string().min(1),
  value: z.number(),
  dimensions: z.record(z.string()).optional().default({}),
  timestamp: z.string().datetime().optional(),
});

const VALID_WINDOWS: AggregateWindow[] = ['1h', '1d', '1w'];
const VALID_TEMPLATES: DashboardTemplate[] = ['token-efficiency', 'connector-health', 'user-adoption', 'cost-trends'];

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/analytics
 */
export function makeAnalyticsRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const svc = new AnalyticsService(sql);

  // POST /analytics/events — record a metric event
  app.post('/events', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'missing_workspace', message: 'X-Workspace-Id header required' } }, 400);
    const parsed = RecordEventSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { name, value, dimensions, timestamp } = parsed.data;
    const result = await svc.recordMetricEvent(name, value, dimensions, workspaceId, timestamp ? new Date(timestamp) : new Date());
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  // GET /analytics/metrics/:name — aggregate for a metric
  app.get('/metrics/:name', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'missing_workspace', message: 'X-Workspace-Id header required' } }, 400);
    const name = c.req.param('name');
    const windowParam = (c.req.query('window') ?? '1d') as AggregateWindow;
    if (!VALID_WINDOWS.includes(windowParam)) {
      return c.json({ error: { code: 'invalid_window', message: `window must be one of: ${VALID_WINDOWS.join(', ')}` } }, 400);
    }
    const result = await svc.aggregateMetrics(name, windowParam, workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // GET /analytics/metrics/:name/anomalies — anomaly detection
  app.get('/metrics/:name/anomalies', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'missing_workspace', message: 'X-Workspace-Id header required' } }, 400);
    const name = c.req.param('name');
    const hours = Math.min(Number(c.req.query('hours') ?? 24), 168);
    const threshold = Number(c.req.query('threshold') ?? 2.5);
    const result = await svc.detectMetricAnomalies(name, workspaceId, hours, threshold);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    const anomalies = result.value.filter((r) => r.isAnomaly);
    return c.json({ data: anomalies, meta: { total: result.value.length, anomalyCount: anomalies.length } });
  });

  // GET /analytics/dashboards/:templateName — pre-computed dashboard view
  app.get('/dashboards/:templateName', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'missing_workspace', message: 'X-Workspace-Id header required' } }, 400);
    const template = c.req.param('templateName') as DashboardTemplate;
    if (!VALID_TEMPLATES.includes(template)) {
      return c.json({ error: { code: 'invalid_template', message: `template must be one of: ${VALID_TEMPLATES.join(', ')}` } }, 400);
    }
    const window = (c.req.query('window') ?? '1d') as AggregateWindow;
    const result = await svc.getDashboard(template, workspaceId, window);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // POST /analytics/rollup — trigger manual rollup of old data
  app.post('/rollup', async (c) => {
    const result = await svc.rollupOldData();
    if (result.isErr()) return c.json({ error: { code: 'rollup_error', message: result.error.message } }, 500);
    return c.json({ data: { rolledUpEvents: result.value } });
  });

  return app;
}
