import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type postgres from 'postgres';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

vi.mock('@iris/semantic-core', () => ({
  TokenAnalytics: vi.fn().mockImplementation(() => ({
    getAnalytics: vi.fn().mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: { days: [], cacheHitRate: 0, compressionRatio: 0 },
    }),
    logQuery: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createAnalyticsRoutes } from '../routes/analytics.js';

type SqlClient = ReturnType<typeof postgres>;

const BREAKDOWN_ROWS = [
  {
    bucket: '2026-06-01T00:00:00',
    group_name: 'hubspot',
    tokens_spent: '1200',
    tokens_saved: '300',
    query_count: '25',
  },
  {
    bucket: '2026-06-01T00:00:00',
    group_name: 'slack',
    tokens_spent: '800',
    tokens_saved: '100',
    query_count: '15',
  },
  {
    bucket: '2026-06-02T00:00:00',
    group_name: 'hubspot',
    tokens_spent: '1500',
    tokens_saved: '400',
    query_count: '30',
  },
];

function makeSql(rows: unknown[]): SqlClient {
  const fn = vi.fn().mockResolvedValue(rows);
  return fn as unknown as SqlClient;
}

function makeSqlError(): SqlClient {
  const fn = vi.fn().mockRejectedValue(new Error('DB error'));
  return fn as unknown as SqlClient;
}

function makeApp(sql: SqlClient): Hono {
  const app = new Hono();
  app.route('/api/v1/analytics', createAnalyticsRoutes(sql));
  return app;
}

describe('GET /api/v1/analytics/breakdown', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns bucketed breakdown data', async () => {
    const app = makeApp(makeSql(BREAKDOWN_ROWS));
    const res = await app.request('/api/v1/analytics/breakdown?workspaceId=ws-test');
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { buckets: unknown[]; groupNames: string[] } };
    expect(body.data.buckets).toHaveLength(2);
    expect(body.data.groupNames).toContain('hubspot');
    expect(body.data.groupNames).toContain('slack');
  });

  it('defaults granularity to daily and groupBy to connector', async () => {
    const sql = makeSql(BREAKDOWN_ROWS);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/analytics/breakdown?workspaceId=ws-test');
    const body = await res.json() as { data: { granularity: string; groupBy: string } };
    expect(body.data.granularity).toBe('daily');
    expect(body.data.groupBy).toBe('connector');
  });

  it('accepts custom granularity and groupBy', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request(
      '/api/v1/analytics/breakdown?workspaceId=ws-test&granularity=monthly&groupBy=tool',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { granularity: string; groupBy: string } };
    expect(body.data.granularity).toBe('monthly');
    expect(body.data.groupBy).toBe('tool');
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request('/api/v1/analytics/breakdown');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid granularity value', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request(
      '/api/v1/analytics/breakdown?workspaceId=ws-test&granularity=secondly',
    );
    expect(res.status).toBe(400);
  });

  it('returns empty buckets when no data', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request('/api/v1/analytics/breakdown?workspaceId=ws-test');
    const body = await res.json() as { data: { buckets: unknown[]; groupNames: string[] } };
    expect(body.data.buckets).toHaveLength(0);
    expect(body.data.groupNames).toHaveLength(0);
  });

  it('returns 500 on DB error', async () => {
    const app = makeApp(makeSqlError());
    const res = await app.request('/api/v1/analytics/breakdown?workspaceId=ws-test');
    expect(res.status).toBe(500);
  });
});
