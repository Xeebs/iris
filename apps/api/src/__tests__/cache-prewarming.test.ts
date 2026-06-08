import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createCachePrewarmingRoutes } from '../routes/cache-prewarming.js';
import * as prewarmer from '@iris/semantic-core/cache-prewarmer';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/cache-prewarmer');

const mockPrewarmer = vi.mocked(prewarmer);

function buildApp() {
  const sql = vi.fn().mockResolvedValue([]);
  const app = new Hono();
  app.route('/api/v1/cache', createCachePrewarmingRoutes(sql as never));
  return { app, sql };
}

beforeEach(() => vi.resetAllMocks());

describe('GET /api/v1/cache/prewarming-stats', () => {
  it('returns 400 without workspaceId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v1/cache/prewarming-stats');
    expect(res.status).toBe(400);
  });

  it('returns stats on success', async () => {
    mockPrewarmer.measurePrefixCacheHits.mockResolvedValue(ok({
      workspaceId: 'ws-1',
      periodStart: new Date(),
      periodEnd: new Date(),
      totalPredictions: 100,
      cacheHitsFromWarming: 70,
      accuracyRatio: 0.7,
      avgLatencyImprovementMs: 105,
    }));
    const { app } = buildApp();
    const res = await app.request('/api/v1/cache/prewarming-stats?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { accuracyRatio: number } };
    expect(body.data.accuracyRatio).toBe(0.7);
  });

  it('returns 500 on failure', async () => {
    mockPrewarmer.measurePrefixCacheHits.mockResolvedValue(err(new Error('db error')));
    const { app } = buildApp();
    const res = await app.request('/api/v1/cache/prewarming-stats?workspaceId=ws-1');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/cache/patterns', () => {
  it('returns co-occurrence patterns', async () => {
    mockPrewarmer.analyzeQueryPatterns.mockResolvedValue(ok([
      { entityTypeA: 'contact', entityTypeB: 'deal', coOccurrenceScore: 0.4, timeOfDayBias: [] },
    ]));
    const { app } = buildApp();
    const res = await app.request('/api/v1/cache/patterns?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('POST /api/v1/cache/preload', () => {
  it('returns 400 for invalid body', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v1/cache/preload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }), // missing entityIds
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 with preload result', async () => {
    mockPrewarmer.preloadToCache.mockResolvedValue(ok({
      entityIds: ['ent-1', 'ent-2'],
      loadedCount: 2,
      ttlSeconds: 300,
      warmedAt: new Date(),
    }));
    const { app } = buildApp();
    const res = await app.request('/api/v1/cache/preload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', entityIds: ['ent-1', 'ent-2'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { loadedCount: number } };
    expect(body.data.loadedCount).toBe(2);
  });
});

describe('POST /api/v1/cache/predict', () => {
  it('returns 400 without query', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v1/cache/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns predicted context', async () => {
    mockPrewarmer.predictNextContext.mockResolvedValue(ok({
      entityIds: ['ent-1'],
      entityTypes: ['contact'],
      confidenceScore: 0.75,
      predictedAt: new Date(),
      ttlSeconds: 300,
    }));
    const { app } = buildApp();
    const res = await app.request('/api/v1/cache/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', query: 'find contacts', entityIds: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { confidenceScore: number } };
    expect(body.data.confidenceScore).toBe(0.75);
  });
});
