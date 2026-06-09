import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAdminSyncMonitoringRoutes } from '../routes/admin-sync-monitoring.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  },
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

const queueStats = { active: 2, waiting: 3, completed: 100, failed: 1, delayed: 0 };

const activeJobsFixture = [
  {
    jobId: 'j1',
    connectorInstanceId: 'ci-1',
    workspaceId: 'ws-1',
    triggeredAt: new Date().toISOString(),
    state: 'active' as const,
    progress: 45,
    elapsedMs: 5000,
  },
  {
    jobId: 'j2',
    connectorInstanceId: 'ci-2',
    workspaceId: 'ws-1',
    triggeredAt: new Date().toISOString(),
    state: 'active' as const,
    progress: 90,
    elapsedMs: 2000,
  },
];

const completedSyncRow = {
  job_id: 'j1',
  connector_instance_id: 'ci-1',
  workspace_id: 'ws-1',
  total_duration_ms: 5000,
  api_time_ms: 2000,
  indexing_time_ms: 1500,
  embedding_time_ms: 800,
  api_calls: 10,
  entities_synced: 500,
  error_count: 0,
  status: 'completed',
  started_at: new Date(),
  completed_at: new Date(),
};

const failedSyncRow = {
  ...completedSyncRow,
  job_id: 'j2',
  status: 'failed',
  error_count: 5,
  entities_synced: 100,
  completed_at: new Date(),
};

const connectorThroughputRow = {
  connector_instance_id: 'ci-1',
  total_entities: 500,
  avg_duration_ms: 5000,
  error_rate: 0,
  last_sync: new Date(),
};

function makeApp(sqlFn?: ReturnType<typeof vi.fn>) {
  const mockSqlFn =
    sqlFn ??
    vi.fn((strings: TemplateStringsArray) => {
      const q = strings.join('?');
      if (q.includes('GROUP BY')) return Promise.resolve([connectorThroughputRow]);
      return Promise.resolve([completedSyncRow]);
    });

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route(
    '/',
    createAdminSyncMonitoringRoutes(
      mockSqlFn as unknown as ReturnType<typeof import('postgres').default>,
      'redis://localhost:6379'
    )
  );
  return app;
}

describe('admin-sync-monitoring routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue.getQueueStats.mockResolvedValue(ok(queueStats));
    mockQueue.getActiveJobs.mockResolvedValue(ok(activeJobsFixture));
    mockQueue.close.mockResolvedValue(undefined);
  });

  describe('GET /status', () => {
    it('returns 200 with complete monitoring payload', async () => {
      const res = await makeApp().request('/status');
      expect(res.status).toBe(200);
    });

    it('includes queue stats in response', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data['queue']).toEqual(queueStats);
    });

    it('includes active jobs list', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(Array.isArray(body.data['activeJobs'])).toBe(true);
      expect((body.data['activeJobs'] as unknown[]).length).toBe(2);
    });

    it('includes recent syncs list', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(Array.isArray(body.data['recentSyncs'])).toBe(true);
    });

    it('includes connector throughput breakdown', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(Array.isArray(body.data['connectorThroughput'])).toBe(true);
    });

    it('includes throughputPerSecond as a number', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(typeof body.data['throughputPerSecond']).toBe('number');
    });

    it('includes generatedAt ISO timestamp', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(typeof body.data['generatedAt']).toBe('string');
      expect(() => new Date(body.data['generatedAt'] as string)).not.toThrow();
    });

    it('falls back to zero queue stats when queue returns err', async () => {
      mockQueue.getQueueStats.mockResolvedValueOnce(err(new Error('redis down')));
      mockQueue.getActiveJobs.mockResolvedValueOnce(ok([]));
      const res = await makeApp().request('/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data['queue']).toEqual({ active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0 });
    });

    it('falls back to empty active jobs when queue returns err', async () => {
      mockQueue.getActiveJobs.mockResolvedValueOnce(err(new Error('redis timeout')));
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data['activeJobs']).toEqual([]);
    });

    it('returns 500 when SQL throws', async () => {
      const failSql = vi.fn().mockRejectedValue(new Error('DB error'));
      const res = await makeApp(failSql).request('/status');
      expect(res.status).toBe(500);
    });

    it('closes queue connection after responding', async () => {
      await makeApp().request('/status');
      expect(mockQueue.close).toHaveBeenCalledOnce();
    });

    it('computes throughput only for completed syncs with entities', async () => {
      const mixedSql = vi.fn((strings: TemplateStringsArray) => {
        const q = strings.join('?');
        if (q.includes('GROUP BY')) return Promise.resolve([connectorThroughputRow]);
        return Promise.resolve([completedSyncRow, failedSyncRow]);
      });
      const res = await makeApp(mixedSql).request('/status');
      const body = (await res.json()) as { data: { throughputPerSecond: number } };
      expect(body.data.throughputPerSecond).toBeGreaterThan(0);
    });

    it('returns throughputPerSecond of 0 when no completed syncs', async () => {
      const emptySql = vi.fn((strings: TemplateStringsArray) => {
        const q = strings.join('?');
        if (q.includes('GROUP BY')) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      const res = await makeApp(emptySql).request('/status');
      const body = (await res.json()) as { data: { throughputPerSecond: number } };
      expect(body.data.throughputPerSecond).toBe(0);
    });

    it('rounds throughputPerSecond to one decimal', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: { throughputPerSecond: number } };
      const str = body.data.throughputPerSecond.toString();
      const decimals = str.includes('.') ? str.split('.')[1]!.length : 0;
      expect(decimals).toBeLessThanOrEqual(1);
    });

    it('returns recent syncs with status field', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: { recentSyncs: Array<{ status: string }> } };
      expect(body.data.recentSyncs.every((s) => typeof s.status === 'string')).toBe(true);
    });

    it('includes entities_synced in recent syncs', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: { recentSyncs: Array<{ entities_synced: number }> } };
      expect(body.data.recentSyncs[0]!.entities_synced).toBeGreaterThanOrEqual(0);
    });

    it('includes error_count in recent syncs', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: { recentSyncs: Array<{ error_count: number }> } };
      expect(typeof body.data.recentSyncs[0]!.error_count).toBe('number');
    });

    it('includes connector_instance_id in throughput rows', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as {
        data: { connectorThroughput: Array<{ connector_instance_id: string }> };
      };
      expect(body.data.connectorThroughput[0]!.connector_instance_id).toBe('ci-1');
    });

    it('includes active job progress in response', async () => {
      const res = await makeApp().request('/status');
      const body = (await res.json()) as { data: { activeJobs: Array<{ progress: number }> } };
      expect(body.data.activeJobs[0]!.progress).toBe(45);
    });
  });
});
