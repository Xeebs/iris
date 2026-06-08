import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSyncMetricsRoutes } from '../routes/sync-metrics.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/sync-optimizer', () => ({
  SyncOptimizer: vi.fn().mockImplementation(() => ({
    analyzeHistoricalSyncMetrics: vi.fn(),
    logSyncMetric: vi.fn(),
    getOptimizationReport: vi.fn(),
    recommendOptimalBatchSize: vi.fn(),
    recommendParallelism: vi.fn(),
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import { SyncOptimizer } from '@iris/semantic-core/sync-optimizer';

const CONNECTOR_ID = 'postgres-prod';

function buildApp() {
  const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createSyncMetricsRoutes>[0];
  const router = createSyncMetricsRoutes(sqlMock);

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/api/v1/connectors', router);

  const instance = (SyncOptimizer as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value as Record<string, ReturnType<typeof vi.fn>>;
  return { app, optimizer: instance };
}

describe('GET /api/v1/connectors/:connectorId/sync-metrics', () => {
  let app: Hono;
  let optimizer: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, optimizer } = buildApp());
  });

  it('returns 200 with latency stats', async () => {
    optimizer['analyzeHistoricalSyncMetrics'].mockResolvedValueOnce(ok({
      p50Ms: 2000, p95Ms: 8000, p99Ms: 12000,
      avgEntityThroughput: 50, avgTokenThroughput: 2500,
      totalSyncs: 30, failureRate: 0.03,
    }));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/sync-metrics`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { totalSyncs: number } };
    expect(body.data.totalSyncs).toBe(30);
  });

  it('returns 500 on analysis failure', async () => {
    optimizer['analyzeHistoricalSyncMetrics'].mockResolvedValueOnce(err(new Error('db down')));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/sync-metrics`);
    expect(res.status).toBe(500);
  });

  it('passes days query param to optimizer', async () => {
    optimizer['analyzeHistoricalSyncMetrics'].mockResolvedValueOnce(ok({
      p50Ms: 0, p95Ms: 0, p99Ms: 0,
      avgEntityThroughput: 0, avgTokenThroughput: 0,
      totalSyncs: 0, failureRate: 0,
    }));
    await app.request(`/api/v1/connectors/${CONNECTOR_ID}/sync-metrics?days=7`);
    expect(optimizer['analyzeHistoricalSyncMetrics']).toHaveBeenCalledWith(CONNECTOR_ID, 7);
  });
});

describe('POST /api/v1/connectors/:connectorId/sync-metrics', () => {
  let app: Hono;
  let optimizer: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, optimizer } = buildApp());
  });

  it('logs metric and returns 201', async () => {
    optimizer['logSyncMetric'].mockResolvedValueOnce(ok(undefined));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/sync-metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncId: 'sync-1', batchSize: 100, entityCount: 95,
        tokenCount: 4750, durationMs: 2000,
        apiCalls: 5, rateLimited: false, errorCount: 0,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { logged: boolean } };
    expect(body.data.logged).toBe(true);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/sync-metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchSize: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on log failure', async () => {
    optimizer['logSyncMetric'].mockResolvedValueOnce(err(new Error('insert failed')));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/sync-metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncId: 'sync-1', batchSize: 100, entityCount: 95,
        tokenCount: 4750, durationMs: 2000,
      }),
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/connectors/:connectorId/optimize', () => {
  let app: Hono;
  let optimizer: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, optimizer } = buildApp());
  });

  it('returns 201 with optimization report', async () => {
    const report = {
      connectorId: CONNECTOR_ID,
      workspaceId: 'ws-test',
      latencyStats: { p50Ms: 2000, p95Ms: 8000, p99Ms: 12000, avgEntityThroughput: 50, avgTokenThroughput: 2500, totalSyncs: 30, failureRate: 0 },
      batchSizeRecommendation: { connectorId: CONNECTOR_ID, recommendedBatchSize: 150, currentAvgBatchSize: 100, predictedDurationMs: 5000, targetDurationMs: 300_000, confidence: 'medium' },
      parallelismRecommendation: { connectorId: CONNECTOR_ID, recommendedParallelism: 3, rateLimitedFraction: 0.1, cpuCount: 4 },
      bottleneck: 'processing_time',
      estimatedThroughputGain: 0.2,
      generatedAt: new Date(),
    };
    optimizer['getOptimizationReport'].mockResolvedValueOnce(ok(report));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/optimize`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { bottleneck: string } };
    expect(body.data.bottleneck).toBe('processing_time');
  });

  it('returns 500 on optimization failure', async () => {
    optimizer['getOptimizationReport'].mockResolvedValueOnce(err(new Error('analysis failed')));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/optimize`, { method: 'POST' });
    expect(res.status).toBe(500);
  });
});
