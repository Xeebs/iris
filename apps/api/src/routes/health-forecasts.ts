import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'health-forecasts-routes' });

type ForecastRow = {
  forecast_id: string;
  connector_id: string;
  forecast_date: Date;
  forecasted_score: string;
  confidence_interval_low: string;
  confidence_interval_high: string;
  model_type: string;
  created_at: Date;
};

type AlertRow = {
  alert_id: string;
  connector_id: string;
  alert_severity: string;
  predicted_issue: string;
  days_until_threshold: number;
  current_score: string | null;
  predicted_score: string | null;
  recommended_action: string | null;
  acknowledged_at: Date | null;
  created_at: Date;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for health forecast endpoints
 */
export function createHealthForecastRoutes(sql: Sql) {
  const app = new Hono();

  // GET /connectors/:id/forecast — 7-day health forecast with confidence bands
  app.get('/:id/forecast', async (c) => {
    const connectorId = c.req.param('id');
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 30);

    try {
      const rows = await sql`
        SELECT forecast_id, connector_id, forecast_date, forecasted_score,
               confidence_interval_low, confidence_interval_high, model_type, created_at
        FROM health_forecasts
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
          AND forecast_date >= CURRENT_DATE
        ORDER BY forecast_date ASC
        LIMIT ${days}
      ` as ForecastRow[];

      return c.json({
        data: {
          connectorId,
          forecastDays: days,
          forecast: rows.map((r) => ({
            date: r.forecast_date,
            predictedScore: parseFloat(r.forecasted_score),
            confidenceLow: parseFloat(r.confidence_interval_low),
            confidenceHigh: parseFloat(r.confidence_interval_high),
          })),
          modelType: rows[0]?.model_type ?? 'exponential_smoothing',
        },
      });
    } catch (err) {
      log.error('Failed to fetch forecast', { connectorId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch health forecast' } }, 500);
    }
  });

  // GET /connectors/:id/forecast-alerts — active predicted issues
  app.get('/:id/forecast-alerts', async (c) => {
    const connectorId = c.req.param('id');
    const workspaceId = c.req.query('workspaceId') ?? 'default';

    try {
      const rows = await sql`
        SELECT alert_id, connector_id, alert_severity, predicted_issue,
               days_until_threshold, current_score, predicted_score,
               recommended_action, acknowledged_at, created_at
        FROM forecast_alerts
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
          AND acknowledged_at IS NULL
        ORDER BY
          CASE alert_severity WHEN 'critical' THEN 1 ELSE 2 END,
          days_until_threshold ASC
      ` as AlertRow[];

      return c.json({
        data: rows.map((r) => ({
          alertId: r.alert_id,
          severity: r.alert_severity,
          predictedIssue: r.predicted_issue,
          daysUntilThreshold: r.days_until_threshold,
          currentScore: r.current_score !== null ? parseFloat(r.current_score) : null,
          predictedScore: r.predicted_score !== null ? parseFloat(r.predicted_score) : null,
          recommendedAction: r.recommended_action,
          createdAt: r.created_at,
        })),
        meta: { total: rows.length, criticalCount: rows.filter((r) => r.alert_severity === 'critical').length },
      });
    } catch (err) {
      log.error('Failed to fetch forecast alerts', { connectorId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch forecast alerts' } }, 500);
    }
  });

  return app;
}
