import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@iris/semantic-core/multi-connector-optimizer', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/multi-connector-optimizer')>(
    '@iris/semantic-core/multi-connector-optimizer'
  );
  return { ...actual };
});

import { createMultiConnectorOptimizerRoutes } from '../routes/multi-connector-optimizer.js';

function makeSql() {
  return vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/query-optimizer', createMultiConnectorOptimizerRoutes(sql as unknown as ReturnType<typeof import('postgres').default>));
  return app;
}

const BASE = 'http://localhost';

const sampleConnectors = [
  {
    connectorId: 'hubspot',
    entityTypes: ['contact', 'company', 'deal'],
    avgLatencyMs: 200,
    cacheHitRate: 0.4,
    costPerRequest: 2,
  },
  {
    connectorId: 'salesforce',
    entityTypes: ['account', 'opportunity'],
    avgLatencyMs: 350,
    cacheHitRate: 0.3,
    costPerRequest: 4,
  },
];

describe('multi-connector-optimizer routes', () => {
  let sql: ReturnType<typeof makeSql>;
  let app: Hono;

  beforeEach(() => {
    sql = makeSql();
    app = buildApp(sql);
    vi.clearAllMocks();
  });

  describe('POST /query-optimizer/plan', () => {
    it('returns 200 with a plan', async () => {
      const res = await app.request(`${BASE}/query-optimizer/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'show contacts', connectors: sampleConnectors }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { strategy: string } };
      expect(body.data).toHaveProperty('strategy');
    });

    it('returns strategy field with valid value', async () => {
      const res = await app.request(`${BASE}/query-optimizer/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'deals report', connectors: sampleConnectors }),
      });
      const body = await res.json() as { data: { strategy: string } };
      expect(['parallel', 'sequential', 'filtered-first', 'cached-first']).toContain(body.data.strategy);
    });

    it('returns 400 when query is missing', async () => {
      const res = await app.request(`${BASE}/query-optimizer/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectors: sampleConnectors }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when connectors array is empty', async () => {
      const res = await app.request(`${BASE}/query-optimizer/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'test', connectors: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns plan with estimatedLatencyP95Ms', async () => {
      const res = await app.request(`${BASE}/query-optimizer/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'contact list', connectors: sampleConnectors }),
      });
      const body = await res.json() as { data: { estimatedLatencyP95Ms: number } };
      expect(typeof body.data.estimatedLatencyP95Ms).toBe('number');
    });

    it('returns plan with strategyRankings array', async () => {
      const res = await app.request(`${BASE}/query-optimizer/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'contacts', connectors: sampleConnectors }),
      });
      const body = await res.json() as { data: { strategyRankings: unknown[] } };
      expect(Array.isArray(body.data.strategyRankings)).toBe(true);
    });

    it('returns plan with reasoning string', async () => {
      const res = await app.request(`${BASE}/query-optimizer/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'deals', connectors: sampleConnectors }),
      });
      const body = await res.json() as { data: { reasoning: string } };
      expect(typeof body.data.reasoning).toBe('string');
      expect(body.data.reasoning.length).toBeGreaterThan(0);
    });

    it('applies preferLowCost constraint', async () => {
      const res = await app.request(`${BASE}/query-optimizer/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'deals',
          connectors: sampleConnectors,
          constraints: { maxLatencyMs: 5000, maxTokens: 8000, preferLowCost: true },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { strategy: string } };
      expect(['sequential', 'cached-first']).toContain(body.data.strategy);
    });
  });

  describe('GET /query-optimizer/history', () => {
    it('returns 200 with empty data when no plans exist', async () => {
      const res = await app.request(`${BASE}/query-optimizer/history`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toHaveProperty('hasMore');
    });

    it('returns 500 when sql throws', async () => {
      app = buildApp(vi.fn().mockRejectedValueOnce(new Error('DB error')) as unknown as ReturnType<typeof makeSql>);
      const res = await app.request(`${BASE}/query-optimizer/history`);
      expect(res.status).toBe(500);
    });

    it('accepts limit query param', async () => {
      const res = await app.request(`${BASE}/query-optimizer/history?limit=5`);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /query-optimizer/estimate', () => {
    it('returns 200 with cost estimate', async () => {
      const res = await app.request(`${BASE}/query-optimizer/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'parallel', connectors: sampleConnectors }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { latencyP95Ms: number; tokens: number; cost: number } };
      expect(body.data).toHaveProperty('latencyP95Ms');
      expect(body.data).toHaveProperty('tokens');
      expect(body.data).toHaveProperty('cost');
    });

    it('returns 400 for invalid strategy', async () => {
      const res = await app.request(`${BASE}/query-optimizer/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'invalid', connectors: sampleConnectors }),
      });
      expect(res.status).toBe(400);
    });

    it('estimates sequential lower cost than parallel', async () => {
      const [parallelRes, seqRes] = await Promise.all([
        app.request(`${BASE}/query-optimizer/estimate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ strategy: 'parallel', connectors: sampleConnectors }),
        }),
        app.request(`${BASE}/query-optimizer/estimate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ strategy: 'sequential', connectors: sampleConnectors }),
        }),
      ]);
      const parallelBody = await parallelRes.json() as { data: { cost: number } };
      const seqBody = await seqRes.json() as { data: { cost: number } };
      expect(seqBody.data.cost).toBeLessThan(parallelBody.data.cost);
    });
  });
});
