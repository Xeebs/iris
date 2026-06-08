import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/query-cluster-engine', () => ({
  clusterQueriesBySemanticSimilarity: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: [
      {
        clusterId: 'ws1-cluster-0',
        workspaceId: 'ws1',
        clusterSignature: '{"entityTypes":["contact"],"intent":"operational"}',
        memberCount: 12,
        dominantEntityTypes: ['contact', 'deal'],
        updateFrequencyPercentile: 15,
        optimalTtlSeconds: 86400,
        confidenceScore: 0.87,
        createdAt: new Date('2026-06-08T00:00:00Z'),
      },
    ],
  })),
  adaptiveTtlAssignment: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      queryHash: 'q1',
      clusterId: 'ws1-cluster-0',
      ttlSeconds: 86400,
      strategy: 'stable_reference',
      similarityScore: 0.91,
    },
  })),
  detectCacheInvalidationPatterns: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      workspaceId: 'ws1',
      triggerEntityType: 'contact',
      affectedClusters: ['ws1-cluster-0'],
      cascadeDepth: 1,
      occurredAt: new Date(),
    },
  })),
  persistClusters: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import routeModule from '../routes/query-clustering';

function buildApp() {
  const app = new Hono();
  app.route('/cache', routeModule);
  return app;
}

describe('GET /cache/clusters', () => {
  it('returns cluster list with meta', async () => {
    const res = await buildApp().request('/cache/clusters', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ clusterId: string; optimalTtlSeconds: number }>; meta: { count: number } };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.optimalTtlSeconds).toBe(86400);
    expect(body.meta.count).toBe(1);
  });

  it('accepts days query parameter', async () => {
    const res = await buildApp().request('/cache/clusters?days=14', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /cache/clusters/:clusterId', () => {
  it('returns cluster detail for known id', async () => {
    const res = await buildApp().request('/cache/clusters/ws1-cluster-0', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { clusterId: string } };
    expect(body.data.clusterId).toBe('ws1-cluster-0');
  });

  it('returns 404 for unknown cluster id', async () => {
    const res = await buildApp().request('/cache/clusters/does-not-exist', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /cache/assign-ttl', () => {
  it('returns TTL assignment for query embedding', async () => {
    const res = await buildApp().request('/cache/assign-ttl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryHash: 'q1', queryEmbedding: [0.1, 0.9] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { ttlSeconds: number; strategy: string } };
    expect(body.data.ttlSeconds).toBe(86400);
    expect(body.data.strategy).toBe('stable_reference');
  });

  it('returns 400 for missing queryHash', async () => {
    const res = await buildApp().request('/cache/assign-ttl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryEmbedding: [0.1] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing embedding', async () => {
    const res = await buildApp().request('/cache/assign-ttl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryHash: 'q1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /cache/invalidate', () => {
  it('returns invalidation event with affected clusters', async () => {
    const res = await buildApp().request('/cache/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerEntityType: 'contact' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { affectedClusters: string[]; cascadeDepth: number } };
    expect(body.data.affectedClusters).toHaveLength(1);
    expect(body.data.cascadeDepth).toBe(1);
  });

  it('returns 400 for missing triggerEntityType', async () => {
    const res = await buildApp().request('/cache/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
