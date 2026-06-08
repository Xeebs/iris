import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createQueryCostAnalysisRoutes } from '../routes/query-cost-analysis.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/query-cost-estimator', () => ({
  QueryCostEstimator: vi.fn().mockImplementation(() => ({
    estimateQueryCost: vi.fn().mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: {
        queryHash: 'abc123',
        provider: 'gpt-4o-mini',
        estimatedDeltaTokens: 120,
        estimatedContextTokens: 640,
        totalEstimatedCostCents: 0.05,
        optimizationSuggestions: [
          { id: 'increase-cache-ttl', description: 'Increase cache TTL', estimatedSavingsPct: 40, effort: 'medium' },
        ],
        createdAt: new Date('2026-01-01'),
      },
    }),
    getCostHistory: vi.fn().mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: {
        entries: [
          {
            queryHash: 'abc123',
            provider: 'gpt-4o-mini',
            estimatedTokens: 760,
            actualTokens: 720,
            estimatedCostCents: 0.05,
            createdAt: new Date('2026-01-01'),
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    }),
  })),
}));

function makeApp() {
  const sql = vi.fn().mockResolvedValue([]);
  const app = new Hono();
  app.route('/api/v1/queries', createQueryCostAnalysisRoutes(sql as never));
  return { app, sql };
}

describe('POST /api/v1/queries/estimate-cost', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it('returns 200 with cost estimate for valid body', async () => {
    const res = await app.request('/api/v1/queries/estimate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'show me SaaS contacts', provider: 'gpt-4o-mini', entityCount: 20 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { queryHash: string; provider: string } };
    expect(body.data.queryHash).toBe('abc123');
    expect(body.data.provider).toBe('gpt-4o-mini');
  });

  it('uses default provider if none specified', async () => {
    const res = await app.request('/api/v1/queries/estimate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'list contacts' }),
    });

    expect(res.status).toBe(200);
  });

  it('returns 400 for empty query string', async () => {
    const res = await app.request('/api/v1/queries/estimate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: '' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid provider value', async () => {
    const res = await app.request('/api/v1/queries/estimate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'list contacts', provider: 'gpt-99' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing body', async () => {
    const res = await app.request('/api/v1/queries/estimate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
    });

    expect(res.status).toBe(400);
  });

  it('returns 500 when estimator fails', async () => {
    const { QueryCostEstimator } = await import('@iris/semantic-core/query-cost-estimator');
    vi.mocked(QueryCostEstimator).mockImplementationOnce(() => ({
      estimateQueryCost: vi.fn().mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: new Error('db error'),
      }),
      getCostHistory: vi.fn(),
    }));

    const sql = vi.fn().mockResolvedValue([]);
    const app2 = new Hono();
    app2.route('/api/v1/queries', createQueryCostAnalysisRoutes(sql as never));

    const res = await app2.request('/api/v1/queries/estimate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'show me contacts' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('ESTIMATION_FAILED');
  });
});

describe('GET /api/v1/queries/cost-history', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it('returns 200 with entries and pagination meta', async () => {
    const res = await app.request('/api/v1/queries/cost-history', {
      headers: { 'x-workspace-id': 'ws1' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean; nextCursor: null } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
  });

  it('accepts limit and cursor query params', async () => {
    const res = await app.request('/api/v1/queries/cost-history?limit=10&cursor=2026-01-01T00:00:00Z', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid limit', async () => {
    const res = await app.request('/api/v1/queries/cost-history?limit=9999', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when history fetch fails', async () => {
    const { QueryCostEstimator } = await import('@iris/semantic-core/query-cost-estimator');
    vi.mocked(QueryCostEstimator).mockImplementationOnce(() => ({
      estimateQueryCost: vi.fn(),
      getCostHistory: vi.fn().mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: new Error('db failure'),
      }),
    }));

    const sql = vi.fn().mockResolvedValue([]);
    const app2 = new Hono();
    app2.route('/api/v1/queries', createQueryCostAnalysisRoutes(sql as never));

    const res = await app2.request('/api/v1/queries/cost-history', {
      headers: { 'x-workspace-id': 'ws1' },
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('FETCH_FAILED');
  });
});
