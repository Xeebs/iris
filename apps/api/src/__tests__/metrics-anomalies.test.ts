import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMetricsAnomalyRoutes } from '../routes/metrics-anomalies.js';

vi.mock('@iris/semantic-core/metrics-anomaly-detector', () => ({
  MetricsAnomalyDetector: vi.fn().mockImplementation(() => ({
    listAnomalies: vi.fn(),
    detectAnomalies: vi.fn(),
    acknowledgeAnomaly: vi.fn(),
    forecastMetricValue: vi.fn(),
    anomalyContext: vi.fn(),
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) },
}));

import { MetricsAnomalyDetector } from '@iris/semantic-core/metrics-anomaly-detector';
import { ok, err } from 'neverthrow';

const METRIC_ID = 'metric:arr';
const ANOMALY_ID = 'anom-1';

function buildApp(): { app: Hono; detector: ReturnType<typeof MetricsAnomalyDetector.prototype.listAnomalies> & Record<string, ReturnType<typeof vi.fn>> } {
  const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createMetricsAnomalyRoutes>[0];
  const router = createMetricsAnomalyRoutes(sqlMock);

  const wrapper = new Hono();
  wrapper.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-1');
    await next();
  });
  wrapper.route('/api/v1/metrics', router);

  const instance = (MetricsAnomalyDetector as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value as Record<string, ReturnType<typeof vi.fn>>;
  return { app: wrapper, detector: instance as unknown as ReturnType<typeof MetricsAnomalyDetector.prototype.listAnomalies> & Record<string, ReturnType<typeof vi.fn>> };
}

describe('GET /api/v1/metrics/:metricId/anomalies', () => {
  let app: Hono;
  let detector: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    detector = built.detector as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it('returns anomalies on success', async () => {
    const anomaly = {
      anomalyId: ANOMALY_ID,
      metricId: METRIC_ID,
      severity: 'high',
      observedValue: 500,
      expectedValue: 100,
    };
    detector['listAnomalies'].mockResolvedValueOnce(ok([anomaly]));

    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('returns 500 on detector failure', async () => {
    detector['listAnomalies'].mockResolvedValueOnce(err(new Error('db error')));
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies`);
    expect(res.status).toBe(500);
  });

  it('passes includeAcknowledged query param', async () => {
    detector['listAnomalies'].mockResolvedValueOnce(ok([]));
    await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies?includeAcknowledged=true`);
    expect(detector['listAnomalies']).toHaveBeenCalledWith(METRIC_ID, true);
  });
});

describe('POST /api/v1/metrics/:metricId/anomalies/detect', () => {
  let app: Hono;
  let detector: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    detector = built.detector as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it('returns 201 with detected anomalies', async () => {
    detector['detectAnomalies'].mockResolvedValueOnce(ok([{ severity: 'high' }]));
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies/detect`, {
      method: 'POST',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('defaults to medium sensitivity', async () => {
    detector['detectAnomalies'].mockResolvedValueOnce(ok([]));
    await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies/detect`, { method: 'POST' });
    expect(detector['detectAnomalies']).toHaveBeenCalledWith(METRIC_ID, 30, 'medium');
  });

  it('accepts custom lookbackDays and sensitivity', async () => {
    detector['detectAnomalies'].mockResolvedValueOnce(ok([]));
    await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies/detect?lookbackDays=14&sensitivity=high`, { method: 'POST' });
    expect(detector['detectAnomalies']).toHaveBeenCalledWith(METRIC_ID, 14, 'high');
  });

  it('returns 400 for invalid sensitivity', async () => {
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies/detect?sensitivity=extreme`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('returns 500 on detector failure', async () => {
    detector['detectAnomalies'].mockResolvedValueOnce(err(new Error('oops')));
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies/detect`, { method: 'POST' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/metrics/:metricId/anomalies/:anomalyId/acknowledge', () => {
  let app: Hono;
  let detector: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    detector = built.detector as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it('acknowledges anomaly successfully', async () => {
    detector['acknowledgeAnomaly'].mockResolvedValueOnce(ok(undefined));
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies/${ANOMALY_ID}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Expected spike' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { acknowledged: boolean } };
    expect(body.data.acknowledged).toBe(true);
  });

  it('acknowledges without notes', async () => {
    detector['acknowledgeAnomaly'].mockResolvedValueOnce(ok(undefined));
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies/${ANOMALY_ID}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it('returns 500 on failure', async () => {
    detector['acknowledgeAnomaly'].mockResolvedValueOnce(err(new Error('not found')));
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/anomalies/${ANOMALY_ID}/acknowledge`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/metrics/:metricId/forecast', () => {
  let app: Hono;
  let detector: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    detector = built.detector as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it('returns forecast points', async () => {
    const points = [{ date: new Date(), forecastedValue: 110, trend: 'up' }];
    detector['forecastMetricValue'].mockResolvedValueOnce(ok(points));
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/forecast`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('defaults to 7 daysAhead and alpha 0.3', async () => {
    detector['forecastMetricValue'].mockResolvedValueOnce(ok([]));
    await app.request(`/api/v1/metrics/${METRIC_ID}/forecast`);
    expect(detector['forecastMetricValue']).toHaveBeenCalledWith(METRIC_ID, 7, 0.3);
  });

  it('returns 400 for invalid daysAhead', async () => {
    const res = await app.request(`/api/v1/metrics/${METRIC_ID}/forecast?daysAhead=999`);
    expect(res.status).toBe(400);
  });
});
