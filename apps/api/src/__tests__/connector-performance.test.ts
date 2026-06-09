import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createConnectorPerformanceRoutes } from '../routes/connector-performance.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/connector-sdk/performance-optimizer', () => ({
  adaptiveBatchSize: vi.fn().mockReturnValue(100),
  computeOptimalConcurrency: vi.fn().mockReturnValue(5),
  identifyPaginationPattern: vi.fn().mockReturnValue('cursor'),
}));

const mockSqlFn = vi.fn((..._args: unknown[]) => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp() {
  const app = new Hono();
  app.route('/connectors', createConnectorPerformanceRoutes(mockSqlFn as never));
  return app;
}

describe('connector-performance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlFn.mockResolvedValue([]);
  });

  describe('GET /connectors/:id/performance-stats', () => {
    const VALID_WS = '00000000-0000-0000-0000-000000000001';

    it('returns grouped performance data for a connector', async () => {
      const rows = [
        {
          sync_run_id: 'run-1',
          metric_name: 'batch_size',
          value: '100',
          value_text: null,
          recorded_at: new Date().toISOString(),
        },
        {
          sync_run_id: 'run-1',
          metric_name: 'concurrency',
          value: '5',
          value_text: null,
          recorded_at: new Date().toISOString(),
        },
        {
          sync_run_id: 'run-1',
          metric_name: 'pagination_type',
          value: '0',
          value_text: 'cursor',
          recorded_at: new Date().toISOString(),
        },
      ];
      mockSqlFn.mockResolvedValueOnce(rows);
      const app = makeApp();

      const res = await app.request(`/connectors/conn-1/performance-stats?workspaceId=${VALID_WS}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
    });

    it('returns empty array when no metrics exist', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request(`/connectors/conn-2/performance-stats?workspaceId=${VALID_WS}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('returns 400 for invalid workspaceId format', async () => {
      const app = makeApp();

      const res = await app.request('/connectors/conn-1/performance-stats?workspaceId=not-a-uuid');

      expect(res.status).toBe(400);
    });

    it('respects the limit query param', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request(`/connectors/conn-1/performance-stats?workspaceId=${VALID_WS}&limit=5`);

      expect(res.status).toBe(200);
    });

    it('returns 500 on database error', async () => {
      mockSqlFn.mockRejectedValueOnce(new Error('connection timeout'));
      const app = makeApp();

      const res = await app.request(`/connectors/conn-1/performance-stats?workspaceId=${VALID_WS}`);

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('PERF_STATS_ERROR');
    });
  });

  describe('POST /connectors/:id/optimize', () => {
    const VALID_WS = '00000000-0000-0000-0000-000000000002';

    const validPayload = {
      workspaceId: VALID_WS,
      recentRecordCount: 5000,
      avgRecordSizeBytes: 1024,
      avgLatencyMs: 200,
      errorRate: 0,
      rateLimit: 10,
      paginationSamples: [{ type: 'cursor' }],
    };

    it('returns optimization recommendations', async () => {
      const app = makeApp();

      const res = await app.request('/connectors/conn-1/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { connectorId: string; batchSize: number; concurrency: number; paginationType: string };
      };
      expect(body.data.connectorId).toBe('conn-1');
      expect(body.data.batchSize).toBe(100);
      expect(body.data.concurrency).toBe(5);
      expect(body.data.paginationType).toBe('cursor');
    });

    it('adds error rate note when errorRate > 5%', async () => {
      const app = makeApp();

      const res = await app.request('/connectors/conn-1/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validPayload, errorRate: 0.1 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { notes: string[] } };
      expect(body.data.notes.some((n) => /error rate/i.test(n))).toBe(true);
    });

    it('adds offset pagination note when pagination type is offset', async () => {
      const { identifyPaginationPattern } = await import('@iris/connector-sdk/performance-optimizer');
      vi.mocked(identifyPaginationPattern).mockReturnValueOnce('offset');
      const app = makeApp();

      const res = await app.request('/connectors/conn-1/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validPayload,
          paginationSamples: [{ type: 'offset' }],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { notes: string[] } };
      expect(body.data.notes.some((n) => /offset/i.test(n))).toBe(true);
    });

    it('adds large record size note when avgRecordSizeBytes > 50KB', async () => {
      const app = makeApp();

      const res = await app.request('/connectors/conn-1/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validPayload, avgRecordSizeBytes: 60_000 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { notes: string[] } };
      expect(body.data.notes.some((n) => /record size/i.test(n))).toBe(true);
    });

    it('returns 400 for missing workspaceId', async () => {
      const app = makeApp();
      const { workspaceId: _ws, ...withoutWs } = validPayload;

      const res = await app.request('/connectors/conn-1/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withoutWs),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 on unexpected error', async () => {
      const { adaptiveBatchSize } = await import('@iris/connector-sdk/performance-optimizer');
      vi.mocked(adaptiveBatchSize).mockImplementationOnce(() => {
        throw new Error('unexpected');
      });
      const app = makeApp();

      const res = await app.request('/connectors/conn-1/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('OPTIMIZE_ERROR');
    });
  });
});
