import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createHealthForecastRoutes } from '../routes/health-forecasts.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp(sqlRows: unknown[] = []) {
  const app = new Hono();
  app.route('/connectors', createHealthForecastRoutes(makeSql(sqlRows)));
  return app;
}

// ─── GET /connectors/:id/forecast ────────────────────────────────────────────

describe('GET /connectors/:id/forecast', () => {
  it('returns 200 with empty forecast when no data', async () => {
    const app = buildApp([]);
    const res = await app.request('/connectors/c-1/forecast?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { forecast: unknown[]; connectorId: string } };
    expect(Array.isArray(body.data.forecast)).toBe(true);
    expect(body.data.connectorId).toBe('c-1');
  });

  it('returns formatted forecast points', async () => {
    const row = {
      forecast_id: 'f-1', connector_id: 'c-1', forecast_date: new Date('2026-06-15'),
      forecasted_score: '75.5', confidence_interval_low: '65.5', confidence_interval_high: '85.5',
      model_type: 'exponential_smoothing', created_at: new Date(),
    };
    const app = buildApp([row]);
    const res = await app.request('/connectors/c-1/forecast?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { forecast: Array<{ predictedScore: number }> } };
    expect(body.data.forecast[0]!.predictedScore).toBe(75.5);
  });

  it('accepts days query param', async () => {
    const app = buildApp([]);
    const res = await app.request('/connectors/c-1/forecast?days=14&workspaceId=ws-1');
    expect(res.status).toBe(200);
  });
});

// ─── GET /connectors/:id/forecast-alerts ─────────────────────────────────────

describe('GET /connectors/:id/forecast-alerts', () => {
  it('returns empty alerts when no active alerts', async () => {
    const app = buildApp([]);
    const res = await app.request('/connectors/c-1/forecast-alerts?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number; criticalCount: number } };
    expect(body.data).toHaveLength(0);
    expect(body.meta.criticalCount).toBe(0);
  });

  it('returns alert with severity and recommendation', async () => {
    const row = {
      alert_id: 'a-1', connector_id: 'c-1', alert_severity: 'critical',
      predicted_issue: 'health_decline', days_until_threshold: 2,
      current_score: '65.0', predicted_score: '45.0',
      recommended_action: 'Investigate immediately', acknowledged_at: null, created_at: new Date(),
    };
    const app = buildApp([row]);
    const res = await app.request('/connectors/c-1/forecast-alerts?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ severity: string; predictedIssue: string }>; meta: { criticalCount: number } };
    expect(body.data[0]!.severity).toBe('critical');
    expect(body.meta.criticalCount).toBe(1);
  });
});
