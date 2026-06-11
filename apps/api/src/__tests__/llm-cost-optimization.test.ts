import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/llm-cost-optimizer', () => ({
  classifyQueryComplexity: vi.fn((q, ctx) => ({
    score: q.length > 50 ? 8 : 3,
    factors: {
      entityCount: ctx?.entityCount ?? 1,
      relationshipDepth: ctx?.relationshipDepth ?? 1,
      contextSizeTokens: ctx?.contextTokens ?? 500,
      requiresReasoning: false,
      requiresCodeGeneration: false,
    },
  })),
  estimateTokenUsage: vi.fn((provider, query, contextTokens, complexity) => ({
    provider,
    estimatedInputTokens: 550,
    estimatedOutputTokens: 130,
    estimatedCostCents: provider === 'gemini' ? 0.05 : 0.20,
    estimatedLatencyMs: 700,
  })),
  rankProvidersByValue: vi.fn(() => [
    { provider: 'gemini', costScore: 1, speedScore: 0.8, accuracyScore: 0.9, valueScore: 0.91 },
    { provider: 'anthropic', costScore: 0.5, speedScore: 0.6, accuracyScore: 0.97, valueScore: 0.75 },
  ]),
  selectOptimalProvider: vi.fn(() => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      provider: 'gemini',
      confidence: 0.91,
      estimatedCostCents: 0.05,
      estimatedLatencyMs: 700,
      rationale: 'Best value',
    },
  })),
  trackProviderAccuracy: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  getCostOptimizationStats: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      totalQueries: 50,
      totalCostCents: 10.5,
      avgCostCentsPerQuery: 0.21,
      estimatedSavingsVsDefault: 4.5,
      providerDistribution: { anthropic: 10, openai: 5, azure: 5, gemini: 30 },
    },
  })),
  getProviderAccuracyBaselines: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: [
      { provider: 'anthropic', complexityRange: [1, 10], accuracyScore: 0.95, sampleCount: 20, measuredAt: new Date() },
    ],
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import { createLlmCostOptimizationRoutes } from '../routes/llm-cost-optimization';

const mockSql = {} as never;

function buildApp() {
  const app = new Hono();
  app.route('/llm-cost-optimization', createLlmCostOptimizationRoutes(mockSql));
  return app;
}

describe('POST /llm-cost-optimization/estimate', () => {
  it('returns optimal provider for a query', async () => {
    const res = await buildApp().request('/llm-cost-optimization/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'show contacts', contextTokens: 400 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { optimal: { provider: string } } };
    expect(body.data.optimal.provider).toBe('gemini');
  });

  it('returns single provider estimate when provider is specified', async () => {
    const res = await buildApp().request('/llm-cost-optimization/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'show contacts', provider: 'anthropic' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { estimate: { provider: string } } };
    expect(body.data.estimate.provider).toBe('anthropic');
  });

  it('returns 400 for missing query', async () => {
    const res = await buildApp().request('/llm-cost-optimization/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextTokens: 200 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid provider', async () => {
    const res = await buildApp().request('/llm-cost-optimization/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', provider: 'invalid-llm' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /llm-cost-optimization/recommendations', () => {
  it('returns ranked providers for complexity score', async () => {
    const res = await buildApp().request('/llm-cost-optimization/recommendations?complexityScore=5');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { ranked: unknown[] } };
    expect(Array.isArray(body.data.ranked)).toBe(true);
  });

  it('defaults to complexity 5 when not specified', async () => {
    const res = await buildApp().request('/llm-cost-optimization/recommendations');
    expect(res.status).toBe(200);
  });

  it('returns 400 for out-of-range complexity score', async () => {
    const res = await buildApp().request('/llm-cost-optimization/recommendations?complexityScore=15');
    expect(res.status).toBe(400);
  });

  it('accepts constraint parameters', async () => {
    const res = await buildApp().request('/llm-cost-optimization/recommendations?complexityScore=7&maxCostCents=1&minAccuracy=0.9');
    expect(res.status).toBe(200);
  });
});

describe('GET /llm-cost-optimization/stats', () => {
  it('returns cost stats for the workspace', async () => {
    const res = await buildApp().request('/llm-cost-optimization/stats', {
      headers: { 'x-workspace-id': 'ws-test' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { totalQueries: number } };
    expect(body.data.totalQueries).toBe(50);
  });

  it('accepts days parameter', async () => {
    const res = await buildApp().request('/llm-cost-optimization/stats?days=7', {
      headers: { 'x-workspace-id': 'ws-test' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid days', async () => {
    const res = await buildApp().request('/llm-cost-optimization/stats?days=999');
    expect(res.status).toBe(400);
  });
});

describe('POST /llm-cost-optimization/track', () => {
  it('records provider accuracy and returns 201', async () => {
    const res = await buildApp().request('/llm-cost-optimization/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-test' },
      body: JSON.stringify({
        queryHash: 'abc123',
        provider: 'gemini',
        actualTokens: 800,
        actualCostCents: 0.08,
        executionTimeMs: 620,
        satisfactionScore: 0.95,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await buildApp().request('/llm-cost-optimization/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    expect(res.status).toBe(400);
  });

  it('records without satisfactionScore', async () => {
    const res = await buildApp().request('/llm-cost-optimization/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryHash: 'xyz789',
        provider: 'anthropic',
        actualTokens: 1200,
        actualCostCents: 0.35,
        executionTimeMs: 950,
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /llm-cost-optimization/accuracy-baselines', () => {
  it('returns provider baselines', async () => {
    const res = await buildApp().request('/llm-cost-optimization/accuracy-baselines', {
      headers: { 'x-workspace-id': 'ws-test' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});
