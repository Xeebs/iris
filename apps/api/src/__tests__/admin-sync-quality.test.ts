import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';
import { createAdminSyncQualityRoutes } from '../routes/admin-sync-quality.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const mockMonitor = {
  trackDataQualityTrend: vi.fn(),
  detectAnomalies: vi.fn(),
  configureThresholds: vi.fn(),
  recordSyncMetrics: vi.fn(),
};

vi.mock('@iris/semantic-core/sync-quality-monitor', () => ({
  SyncQualityMonitor: vi.fn().mockImplementation(() => mockMonitor),
}));

const CONNECTOR = 'conn-abc';
const WS = 'ws-123';

function makeApp(): Hono {
  const app = new Hono();
  const fakeSql = vi.fn() as unknown as Parameters<typeof createAdminSyncQualityRoutes>[0];
  app.route('/admin/connectors', createAdminSyncQualityRoutes(fakeSql));
  return app;
}

const TREND = { connectorId: CONNECTOR, workspaceId: WS, windowDays: 30, dataPoints: [], summary: { entityCountTrend: 'stable', completenessTrend: 'stable', hasRecentAnomaly: false } };
const ANOMALY = { connectorId: CONNECTOR, workspaceId: WS, anomalies: [], detectedAt: new Date() };

describe('GET /admin/connectors/:connectorId/quality', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
    mockMonitor.trackDataQualityTrend.mockResolvedValue(ok(TREND));
    mockMonitor.detectAnomalies.mockResolvedValue(ok(ANOMALY));
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await app.request(`/admin/connectors/${CONNECTOR}/quality`);
    expect(res.status).toBe(400);
  });

  it('returns quality data on success', async () => {
    const res = await app.request(`/admin/connectors/${CONNECTOR}/quality?workspaceId=${WS}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown };
    expect(body.data).toBeDefined();
  });

  it('passes windowDays to trackDataQualityTrend', async () => {
    await app.request(`/admin/connectors/${CONNECTOR}/quality?workspaceId=${WS}&windowDays=14`);
    expect(mockMonitor.trackDataQualityTrend).toHaveBeenCalledWith(CONNECTOR, WS, 14);
  });

  it('defaults windowDays to 30', async () => {
    await app.request(`/admin/connectors/${CONNECTOR}/quality?workspaceId=${WS}`);
    expect(mockMonitor.trackDataQualityTrend).toHaveBeenCalledWith(CONNECTOR, WS, 30);
  });

  it('returns 500 when monitor methods fail', async () => {
    mockMonitor.trackDataQualityTrend.mockResolvedValue(err(new Error('db error')));
    const res = await app.request(`/admin/connectors/${CONNECTOR}/quality?workspaceId=${WS}`);
    expect(res.status).toBe(500);
  });

  it('returns 400 for invalid windowDays (string)', async () => {
    const res = await app.request(`/admin/connectors/${CONNECTOR}/quality?workspaceId=${WS}&windowDays=abc`);
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/connectors/:connectorId/quality/configure', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
    mockMonitor.configureThresholds.mockResolvedValue(ok(undefined));
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await app.request(`/admin/connectors/${CONNECTOR}/quality/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityCountZscoreThreshold: 2.5 }),
    });
    expect(res.status).toBe(400);
  });

  it('configures thresholds and returns updated:true', async () => {
    const res = await app.request(
      `/admin/connectors/${CONNECTOR}/quality/configure?workspaceId=${WS}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityCountZscoreThreshold: 2.5, completenessDropThreshold: 0.15 }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { updated: boolean } };
    expect(body.data.updated).toBe(true);
  });

  it('passes thresholds to configureThresholds', async () => {
    await app.request(
      `/admin/connectors/${CONNECTOR}/quality/configure?workspaceId=${WS}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityCountZscoreThreshold: 4.0 }),
      },
    );
    expect(mockMonitor.configureThresholds).toHaveBeenCalledWith(
      CONNECTOR,
      WS,
      expect.objectContaining({ entityCountZscoreThreshold: 4.0 }),
    );
  });

  it('returns 400 for invalid threshold values', async () => {
    const res = await app.request(
      `/admin/connectors/${CONNECTOR}/quality/configure?workspaceId=${WS}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityCountZscoreThreshold: 999 }),  // exceeds max 10
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 when configureThresholds fails', async () => {
    mockMonitor.configureThresholds.mockResolvedValue(err(new Error('upsert failed')));
    const res = await app.request(
      `/admin/connectors/${CONNECTOR}/quality/configure?workspaceId=${WS}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(500);
  });
});
