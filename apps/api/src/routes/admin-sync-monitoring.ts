import { Hono } from 'hono';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { SyncJobQueue } from '@iris/queue/sync-job-queue';

const log = logger.child({ route: 'admin-sync-monitoring' });

type SqlClient = ReturnType<typeof postgres>;

type RecentSyncRow = {
  job_id: string;
  connector_instance_id: string;
  workspace_id: string;
  total_duration_ms: number | null;
  api_time_ms: number | null;
  indexing_time_ms: number | null;
  embedding_time_ms: number | null;
  api_calls: number;
  entities_synced: number;
  error_count: number;
  status: string;
  started_at: Date;
  completed_at: Date | null;
};

type ConnectorThroughputRow = {
  connector_instance_id: string;
  total_entities: number;
  avg_duration_ms: number | null;
  error_rate: number;
  last_sync: Date | null;
};

/**
 * @param sql       - Postgres client for sync performance data
 * @param redisUrl  - Redis URL for queue stats
 * @returns Hono router mounted at /admin/sync-monitoring
 */
export function createAdminSyncMonitoringRoutes(sql: SqlClient, redisUrl: string): Hono {
  const app = new Hono();

  /** GET /admin/sync-monitoring/status — queue stats + recent syncs + per-connector throughput */
  app.get('/status', async (c) => {
    const queue = new SyncJobQueue(redisUrl);

    try {
      const [statsResult, activeResult] = await Promise.all([
        queue.getQueueStats(),
        queue.getActiveJobs(20),
      ]);

      const queueStats = statsResult.isOk() ? statsResult.value : null;
      const activeJobs = activeResult.isOk() ? activeResult.value : [];

      const recentSyncs = await sql<RecentSyncRow[]>`
        SELECT job_id, connector_instance_id, workspace_id,
               total_duration_ms, api_time_ms, indexing_time_ms, embedding_time_ms,
               api_calls, entities_synced, error_count, status,
               started_at, completed_at
        FROM sync_performance
        ORDER BY started_at DESC
        LIMIT 20
      `;

      const connectorThroughput = await sql<ConnectorThroughputRow[]>`
        SELECT
          connector_instance_id,
          SUM(entities_synced)::INT AS total_entities,
          AVG(total_duration_ms) AS avg_duration_ms,
          CASE WHEN COUNT(*) > 0
               THEN SUM(error_count)::FLOAT / GREATEST(SUM(entities_synced + error_count), 1)
               ELSE 0 END AS error_rate,
          MAX(started_at) AS last_sync
        FROM sync_performance
        WHERE started_at > now() - interval '24 hours'
        GROUP BY connector_instance_id
        ORDER BY total_entities DESC
        LIMIT 10
      `;

      const throughputPerSecond = recentSyncs
        .filter((r) => r.total_duration_ms && r.entities_synced > 0 && r.status === 'completed')
        .map((r) => r.entities_synced / (r.total_duration_ms! / 1000))
        .reduce((a, b, _, arr) => a + b / arr.length, 0);

      log.info('Sync monitoring status fetched', {
        activeJobs: activeJobs.length,
        recentSyncs: recentSyncs.length,
      });

      return c.json({
        data: {
          queue: queueStats ?? { active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0 },
          activeJobs,
          recentSyncs,
          connectorThroughput,
          throughputPerSecond: Math.round(throughputPerSecond * 10) / 10,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      log.error('Failed to fetch sync monitoring status', { error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch monitoring status' } }, 500);
    } finally {
      await queue.close();
    }
  });

  return app;
}
