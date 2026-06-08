import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Sql } from 'postgres';
import {
  adaptiveBatchSize,
  computeOptimalConcurrency,
  identifyPaginationPattern,
} from '@iris/connector-sdk/performance-optimizer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'connector-performance' });

/**
 * Routes for connector sync performance stats and optimization recommendations.
 *
 * @param sql - Postgres client
 */
export function createConnectorPerformanceRoutes(sql: Sql) {
  const app = new Hono();

  // GET /api/v1/connectors/:id/performance-stats?workspaceId=&limit=
  app.get(
    '/:id/performance-stats',
    zValidator(
      'query',
      z.object({
        workspaceId: z.string().uuid(),
        limit: z.coerce.number().min(1).max(100).default(30),
      }),
    ),
    async (c) => {
      const connectorId = c.req.param('id');
      const { workspaceId, limit } = c.req.valid('query');

      try {
        const rows = await sql<
          {
            sync_run_id: string;
            metric_name: string;
            value: string;
            value_text: string | null;
            recorded_at: string;
          }[]
        >`
          SELECT sync_run_id, metric_name, value::text, value_text, recorded_at::text
          FROM connector_sync_metrics
          WHERE connector_id = ${connectorId}
            AND workspace_id = ${workspaceId}::uuid
          ORDER BY recorded_at DESC
          LIMIT ${limit * 10}
        `;

        // Group by sync_run_id
        const byRun = new Map<string, Record<string, unknown>>();
        for (const row of rows) {
          if (!byRun.has(row.sync_run_id)) {
            byRun.set(row.sync_run_id, { syncRunId: row.sync_run_id, recordedAt: row.recorded_at });
          }
          const run = byRun.get(row.sync_run_id)!;
          run[row.metric_name] = row.value_text ?? parseFloat(row.value);
        }

        const data = [...byRun.values()].slice(0, limit);
        return c.json({ data });
      } catch (error) {
        log.error('Failed to fetch performance stats', { connectorId, error });
        return c.json(
          { error: { code: 'PERF_STATS_ERROR', message: 'Failed to retrieve performance stats' } },
          500,
        );
      }
    },
  );

  // POST /api/v1/connectors/:id/optimize
  app.post(
    '/:id/optimize',
    zValidator(
      'json',
      z.object({
        workspaceId: z.string().uuid(),
        recentRecordCount: z.number().min(0).default(0),
        avgRecordSizeBytes: z.number().min(0).default(1024),
        avgLatencyMs: z.number().min(0).default(200),
        errorRate: z.number().min(0).max(1).default(0),
        rateLimit: z.number().min(0).default(10),
        paginationSamples: z
          .array(z.object({ type: z.enum(['cursor', 'offset', 'keyset', 'unknown']) }))
          .default([]),
      }),
    ),
    async (c) => {
      const connectorId = c.req.param('id');
      const body = c.req.valid('json');

      try {
        const recommendedBatchSize = adaptiveBatchSize(
          body.recentRecordCount,
          body.avgRecordSizeBytes,
        );
        const recommendedConcurrency = computeOptimalConcurrency(
          body.rateLimit,
          body.avgLatencyMs,
          body.errorRate,
        );
        const paginationType = identifyPaginationPattern(body.paginationSamples);

        const recommendations = {
          connectorId,
          batchSize: recommendedBatchSize,
          concurrency: recommendedConcurrency,
          paginationType,
          notes: [] as string[],
        };

        if (body.errorRate > 0.05) {
          recommendations.notes.push(
            `Error rate is ${(body.errorRate * 100).toFixed(1)}% — investigate API errors before scaling concurrency`,
          );
        }
        if (paginationType === 'offset') {
          recommendations.notes.push(
            'API appears to use offset pagination — check if cursor-based pagination is available to prevent duplicate/missed records during sync',
          );
        }
        if (body.avgRecordSizeBytes > 50_000) {
          recommendations.notes.push(
            `Average record size is ${Math.round(body.avgRecordSizeBytes / 1024)}KB — consider filtering attributes in the connector schema to reduce record size`,
          );
        }

        return c.json({ data: recommendations });
      } catch (error) {
        log.error('Optimization analysis failed', { connectorId, error });
        return c.json(
          { error: { code: 'OPTIMIZE_ERROR', message: 'Optimization analysis failed' } },
          500,
        );
      }
    },
  );

  return app;
}
