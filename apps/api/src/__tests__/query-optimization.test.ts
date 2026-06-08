import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createQueryOptimizationRoutes } from '../routes/query-optimization.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/query-optimizer', () => ({
  buildExecutionPlan: vi.fn(),
  getOptimizerStats: vi.fn(),
  recordPlanExecution: vi.fn(),
}));

import {
  buildExecutionPlan as mockBuild,
  getOptimizerStats as mockStats,
  recordPlanExecution as mockRecord,
} from '@iris/semantic-core/query-optimizer';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createQueryOptimizationRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/', createQueryOptimizationRoutes(sqlMock));
  return app;
}

beforeEach(() => vi.clearAllMocks());

const planFixture = {
  queryHash: 'abc12345',
  strategy: 'vector_search_only' as const,
  steps: [{ stepId: 'v1', strategy: 'vector_search_only' as const, description: 'vector search', estimatedTokens: 200, estimatedLatencyMs: 150 }],
  estimatedTotalTokens: 200,
  estimatedTotalLatencyMs: 150,
  reasoning: 'General query — direct vector search.',
};

const statsFixture = {
  workspaceId: 'ws-test',
  totalPlans: 100,
  strategyBreakdown: { vector_search_only: 60, cache_check_first: 25, parallel_hybrid: 10, graph_expansion_first: 5 },
  avgTokensSaved: 50,
  avgLatencyImprovementMs: 80,
  cacheHitRate: 0.25,
  slowestQueries: [],
};

describe('POST /queries/optimize', () => {
  it('returns execution plan', async () => {
    (mockBuild as ReturnType<typeof vi.fn>).mockReturnValueOnce(planFixture);
    const res = await makeApp().request('/queries/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'find contacts', filters: {} }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof planFixture };
    expect(body.data.queryHash).toBe('abc12345');
    expect(body.data.strategy).toBe('vector_search_only');
  });

  it('returns 400 when query is missing', async () => {
    const res = await makeApp().request('/queries/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when query is empty string', async () => {
    const res = await makeApp().request('/queries/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /queries/optimizer/record', () => {
  it('records plan execution and returns 201', async () => {
    (mockRecord as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(undefined));
    const res = await makeApp().request('/queries/optimizer/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryHash: 'abc12345',
        strategy: 'vector_search_only',
        estimatedTotalTokens: 200,
        estimatedTotalLatencyMs: 150,
        actualTokens: 180,
        actualLatencyMs: 160,
        cacheHit: false,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await makeApp().request('/queries/optimizer/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryHash: 'abc' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on DB failure', async () => {
    (mockRecord as ReturnType<typeof vi.fn>).mockResolvedValueOnce(err(new Error('db error')));
    const res = await makeApp().request('/queries/optimizer/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryHash: 'abc',
        strategy: 'cache_check_first',
        estimatedTotalTokens: 10,
        estimatedTotalLatencyMs: 20,
        actualTokens: 10,
        actualLatencyMs: 18,
        cacheHit: true,
      }),
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /query-optimizer/stats', () => {
  it('returns optimizer statistics', async () => {
    (mockStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(statsFixture));
    const res = await makeApp().request('/query-optimizer/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof statsFixture };
    expect(body.data.totalPlans).toBe(100);
    expect(body.data.cacheHitRate).toBe(0.25);
    expect(body.data.strategyBreakdown.vector_search_only).toBe(60);
  });

  it('returns 500 on DB failure', async () => {
    (mockStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce(err(new Error('query failed')));
    const res = await makeApp().request('/query-optimizer/stats');
    expect(res.status).toBe(500);
  });
});
