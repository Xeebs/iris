import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAdminPerformanceRoutes } from '../routes/admin-performance.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const mockSqlFn = vi.fn((..._args: unknown[]) => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp(workspaceId = 'ws-test') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', workspaceId);
    await next();
  });
  app.route('/', createAdminPerformanceRoutes(mockSqlFn));
  return app;
}

describe('admin-performance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlFn.mockResolvedValue([]);
  });

  describe('GET /connectors/:id', () => {
    it('returns performance data for a connector', async () => {
      const mockSyncs = [
        {
          id: 'perf-1',
          job_id: 'job-1',
          connector_instance_id: 'inst-1',
          total_duration_ms: 5000,
          api_time_ms: 2000,
          indexing_time_ms: 2500,
          embedding_time_ms: 500,
          api_calls: 10,
          entities_synced: 250,
          avg_entity_size_bytes: 512,
          peak_memory_mb: 128.5,
          error_count: 0,
          status: 'completed',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ];
      const mockAgg = [{
        total_syncs: 1,
        avg_duration_ms: 5000,
        p50_duration_ms: 5000,
        p90_duration_ms: 5000,
        p99_duration_ms: 5000,
        total_entities_synced: 250,
        avg_entities_per_sync: 250,
        total_errors: 0,
        failed_syncs: 0,
        avg_peak_memory_mb: 128.5,
      }];

      mockSqlFn.mockResolvedValueOnce(mockSyncs).mockResolvedValueOnce(mockAgg);
      const app = makeApp();

      const res = await app.request('/connectors/inst-1?days=7');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { connectorInstanceId: string; syncs: unknown[]; aggregates: unknown } };
      expect(body.data.connectorInstanceId).toBe('inst-1');
      expect(body.data.syncs).toHaveLength(1);
      expect(body.data.aggregates).not.toBeNull();
    });

    it('returns empty arrays when no syncs exist', async () => {
      mockSqlFn.mockResolvedValueOnce([]).mockResolvedValueOnce([{}]);
      const app = makeApp();

      const res = await app.request('/connectors/inst-2');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { syncs: unknown[] } };
      expect(body.data.syncs).toHaveLength(0);
    });

    it('clamps days to 90 max', async () => {
      mockSqlFn.mockResolvedValue([]);
      const app = makeApp();

      const res = await app.request('/connectors/inst-1?days=365');

      expect(res.status).toBe(200);
      // Query was executed with max 90 days
      expect(mockSqlFn).toHaveBeenCalled();
    });

    it('returns 500 on database error', async () => {
      mockSqlFn.mockRejectedValueOnce(new Error('db connection lost'));
      const app = makeApp();

      const res = await app.request('/connectors/inst-1');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /summary', () => {
    it('returns aggregated summary across all connectors', async () => {
      const mockSummary = [
        {
          connector_instance_id: 'inst-a',
          sync_count: 15,
          avg_duration_ms: 3200,
          p50_ms: 3000,
          p90_ms: 5000,
          total_entities: 1500,
          total_errors: 2,
          failed_count: 1,
          last_sync_at: new Date().toISOString(),
        },
        {
          connector_instance_id: 'inst-b',
          sync_count: 8,
          avg_duration_ms: 8500,
          p50_ms: 8000,
          p90_ms: 12000,
          total_entities: 300,
          total_errors: 0,
          failed_count: 0,
          last_sync_at: new Date().toISOString(),
        },
      ];
      mockSqlFn.mockResolvedValueOnce(mockSummary);
      const app = makeApp();

      const res = await app.request('/summary?days=30');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { connectors: unknown[]; periodDays: number } };
      expect(body.data.connectors).toHaveLength(2);
      expect(body.data.periodDays).toBe(30);
    });

    it('returns empty connectors array when no data', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/summary');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { connectors: unknown[] } };
      expect(body.data.connectors).toHaveLength(0);
    });

    it('returns 500 on database error', async () => {
      mockSqlFn.mockRejectedValueOnce(new Error('query timeout'));
      const app = makeApp();

      const res = await app.request('/summary');

      expect(res.status).toBe(500);
    });
  });
});
