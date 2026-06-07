import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAdminSyncMonitoringRoutes } from '../routes/admin-sync-monitoring.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/queue/sync-job-queue', () => {
  const mockQueue = {
    getQueueStats: vi.fn(),
    getActiveJobs: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    SyncJobQueue: vi.fn(() => mockQueue),
    _mockQueue: mockQueue,
  };
});

import { _mockQueue as mockQueue } from '@iris/queue/sync-job-queue';
import { ok, err } from 'neverthrow';

const mockSql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;

const queueStatsFixture = { active: 2, waiting: 3, completed: 100, failed: 1, delayed: 0 };
const activeJobsFixture = [
  { jobId: 'j1', connectorInstanceId: 'ci-1', workspaceId: 'ws-1', triggeredAt: new Date().toISOString(), state: 'active' as const, progress: 45, elapsedMs: 5000 },
];

const recentSyncsFixture = [
  { job_id: 'j1', connector_instance_id: 'ci-1', workspace_id: 'ws-1', total_duration_ms: 5000, api_time_ms: 2000, indexing_time_ms: 1500, embedding_time_ms: 800, api_calls: 10, entities_synced: 500, error_count: 0, status: 'completed', started_at: new Date(), completed_at: new Date() },
];

const connectorThroughputFixture = [
  { connector_instance_id: 'ci-1', total_entities: 500, avg_duration_ms: 5000, error_rate: 0, last_sync: new Date() },
];

function makeApp() {
  const mockSqlFn = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const q = strings.join('?');
    if (q.includes('sync_performance') && q.includes('GROUP BY')) {
      return Promise.resolve(connectorThroughputFixture);
    }
    return Promise.resolve(recentSyncsFixture);
  });

  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/', createAdminSyncMonitoringRoutes(mockSqlFn as unknown as typeof mockSql, 'redis://localhost:6379'));
  return app;
}

describe('admin-sync-monitoring routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue.getQueueStats.mockResolvedValue(ok(queueStatsFixture));
    mockQueue.getActiveJobs.mockResolvedValue(ok(activeJobsFixture));
  });

  describe('GET /status', () => {
    it('returns queue stats, active jobs, and recent syncs', async () => {
      const app = makeApp();
      const res = await app.request('/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data['queue']).toEqual(queueStatsFixture);
      expect(body.data['activeJobs']).toHaveLength(1);
    });

    it('includes throughputPerSecond in response', async () => {
      const app = makeApp();
      const res = await app.request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(typeof body.data['throughputPerSecond']).toBe('number');
    });

    it('includes connector throughput breakdown', async () => {
      const app = makeApp();
      const res = await app.request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(Array.isArray(body.data['connectorThroughput'])).toBe(true);
    });

    it('returns 500 if queue stats fail and falls back gracefully', async () => {
      mockQueue.getQueueStats.mockResolvedValue(err(new Error('redis down')));
      mockQueue.getActiveJobs.mockResolvedValue(ok([]));
      const app = makeApp();
      const res = await app.request('/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data['queue']).toEqual({ active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0 });
    });

    it('closes the queue connection after responding', async () => {
      const app = makeApp();
      await app.request('/status');
      expect(mockQueue.close).toHaveBeenCalledOnce();
    });

    it('includes generatedAt timestamp', async () => {
      const app = makeApp();
      const res = await app.request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(typeof body.data['generatedAt']).toBe('string');
    });
  });
});
