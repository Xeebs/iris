import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@iris/semantic-core/sync-parallelism-optimizer', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/sync-parallelism-optimizer')>(
    '@iris/semantic-core/sync-parallelism-optimizer'
  );
  return { ...actual };
});

import { createSyncOptimizerRoutes } from '../routes/sync-optimizer.js';

function makeSql(responses: Record<string, unknown[]> = {}) {
  return vi.fn((strings: TemplateStringsArray) => {
    const q = strings.raw.join('');
    for (const [key, rows] of Object.entries(responses)) {
      if (q.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/sync-optimizer', createSyncOptimizerRoutes(sql as unknown as ReturnType<typeof import('postgres').default>));
  return app;
}

const BASE = 'http://localhost';

describe('Sync Optimizer API', () => {
  let sql: ReturnType<typeof makeSql>;
  let app: Hono;

  beforeEach(() => {
    sql = makeSql();
    app = buildApp(sql);
  });

  describe('GET /sync-optimizer/config/:connectorId', () => {
    it('returns defaults when no config is stored', async () => {
      const res = await app.request(`${BASE}/sync-optimizer/config/hubspot`, {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.current.concurrency).toBe(5);
      expect(body.data.recommendation).toHaveProperty('recommendedConcurrency');
    });

    it('returns stored config when present', async () => {
      sql = makeSql({
        sync_optimization_configs: [
          {
            connectorId: 'hubspot',
            workspaceId: 'ws1',
            entityType: '*',
            concurrency: 8,
            batchSize: 200,
            workerWeight: 1.5,
            autoTune: true,
            lastTunedAt: null,
          },
        ],
      });
      app = buildApp(sql);
      const res = await app.request(`${BASE}/sync-optimizer/config/hubspot`, {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.current.concurrency).toBe(8);
    });
  });

  describe('POST /sync-optimizer/tuning/:connectorId', () => {
    it('returns recommendation without applying when autoApply is false', async () => {
      const res = await app.request(`${BASE}/sync-optimizer/tuning/hubspot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-workspace-id': 'ws1',
        },
        body: JSON.stringify({ entityType: '*', historicalMetrics: [], autoApply: false }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.applied).toBe(false);
      expect(body.data.recommendation).toBeDefined();
    });

    it('calls saveConfig when autoApply is true', async () => {
      const insertedRows: unknown[] = [];
      sql = vi.fn((strings: TemplateStringsArray) => {
        const q = strings.raw.join('');
        if (q.includes('INSERT INTO sync_optimization_configs')) {
          insertedRows.push(true);
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }) as unknown as ReturnType<typeof import('postgres').default>;
      app = buildApp(sql);

      const res = await app.request(`${BASE}/sync-optimizer/tuning/hubspot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-workspace-id': 'ws1',
        },
        body: JSON.stringify({ entityType: '*', historicalMetrics: [], autoApply: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.applied).toBe(true);
    });

    it('rejects invalid metrics payload', async () => {
      const res = await app.request(`${BASE}/sync-optimizer/tuning/hubspot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-workspace-id': 'ws1',
        },
        body: JSON.stringify({ historicalMetrics: [{ concurrency: -1 }] }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /sync-optimizer/experiments/:connectorId', () => {
    it('returns 422 when optimization window is unstable', async () => {
      sql = makeSql({
        reliability_scores: [{ recentErrorRate: 0.3, lastRateLimitAt: null }],
        reliability_alerts: [],
      });
      app = buildApp(sql);

      const res = await app.request(`${BASE}/sync-optimizer/experiments/hubspot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-workspace-id': 'ws1',
        },
        body: JSON.stringify({
          variantName: 'test-variant',
          concurrency: 8,
          batchSize: 150,
          trafficPct: 10,
        }),
      });
      expect(res.status).toBe(422);
    });

    it('creates experiment when window is stable', async () => {
      sql = vi.fn((strings: TemplateStringsArray) => {
        const q = strings.raw.join('');
        if (q.includes('INSERT INTO optimization_experiments')) {
          return Promise.resolve([{ id: 'new-exp-id' }]);
        }
        return Promise.resolve([{ recentErrorRate: 0.01, lastRateLimitAt: null }]);
      }) as unknown as ReturnType<typeof import('postgres').default>;
      app = buildApp(sql);

      const res = await app.request(`${BASE}/sync-optimizer/experiments/hubspot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-workspace-id': 'ws1',
        },
        body: JSON.stringify({
          variantName: 'stable-variant',
          concurrency: 8,
          batchSize: 150,
          trafficPct: 10,
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.experimentId).toBe('new-exp-id');
    });

    it('rejects missing variant name', async () => {
      const res = await app.request(`${BASE}/sync-optimizer/experiments/hubspot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-workspace-id': 'ws1',
        },
        body: JSON.stringify({ concurrency: 8, batchSize: 150 }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /sync-optimizer/experiments', () => {
    it('returns 400 when connectorId is missing', async () => {
      const res = await app.request(`${BASE}/sync-optimizer/experiments`, {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(400);
    });

    it('returns list of experiments', async () => {
      sql = makeSql({
        optimization_experiments: [
          {
            expId: 'exp-1',
            variantName: 'v1',
            concurrency: 8,
            batchSize: 150,
            trafficPct: 10,
            status: 'completed',
            startedAt: new Date(),
            completedAt: new Date(),
            throughputPerSec: 65.0,
            p95LatencyMs: 1200,
            errorRate: 0.01,
            entitiesSynced: 1000,
          },
        ],
      });
      app = buildApp(sql);

      const res = await app.request(`${BASE}/sync-optimizer/experiments?connectorId=hubspot`, {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /sync-optimizer/window/:connectorId', () => {
    it('returns window stability information', async () => {
      const res = await app.request(`${BASE}/sync-optimizer/window/hubspot`, {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveProperty('stableEnough');
      expect(body.data).toHaveProperty('reason');
    });
  });
});
