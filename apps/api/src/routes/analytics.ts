import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { TokenAnalytics } from '@iris/semantic-core';

const log = logger.child({ route: 'analytics' });

const analyticsQuerySchema = z.object({
  workspaceId: z.string().min(1),
  days: z.coerce.number().int().positive().max(365).default(30),
});

const breakdownQuerySchema = z.object({
  workspaceId: z.string().min(1),
  days: z.coerce.number().int().positive().max(365).default(30),
  granularity: z.enum(['hourly', 'daily', 'weekly', 'monthly']).default('daily'),
  groupBy: z.enum(['connector', 'tool']).default('connector'),
});

type SqlClient = ReturnType<typeof postgres>;

export type BreakdownBucket = {
  bucket: string;
  groups: Record<string, { tokensSpent: number; tokensSaved: number; queryCount: number }>;
};

export type BreakdownSummary = {
  buckets: BreakdownBucket[];
  groupNames: string[];
  granularity: string;
  groupBy: string;
};

type BreakdownRow = {
  bucket: string;
  group_name: string;
  tokens_spent: string;
  tokens_saved: string;
  query_count: string;
};

/**
 * @param sql - Postgres client
 */
export function createAnalyticsRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const tokenAnalytics = new TokenAnalytics(sql);

  /** GET /api/v1/analytics/tokens?workspaceId=&days= */
  routes.get('/tokens', async (c) => {
    const parsed = analyticsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'workspaceId is required',
            details: parsed.error.errors,
          },
        },
        400,
      );
    }

    const { workspaceId, days } = parsed.data;
    const result = await tokenAnalytics.getAnalytics(workspaceId, days);

    if (result.isErr()) {
      log.error('Failed to fetch token analytics', { error: result.error, workspaceId });
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch analytics' } },
        500,
      );
    }

    log.info('Token analytics fetched', { workspaceId, days, dayCount: result.value.days.length });
    return c.json({ data: result.value });
  });

  /**
   * GET /api/v1/analytics/breakdown?workspaceId=&granularity=daily&groupBy=connector&days=30
   *
   * Returns token usage grouped by time bucket and dimension (tool_name).
   */
  routes.get('/breakdown', async (c) => {
    const parsed = breakdownQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: parsed.error.errors,
          },
        },
        400,
      );
    }

    const { workspaceId, days, granularity, groupBy } = parsed.data;

    const truncMap = {
      hourly: 'hour',
      daily: 'day',
      weekly: 'week',
      monthly: 'month',
    } as const;
    const trunc = truncMap[granularity];

    try {
      const rows = await sql<BreakdownRow[]>`
        SELECT
          DATE_TRUNC(${trunc}, timestamp)::text                         AS bucket,
          COALESCE(tool_name, 'unknown')                                AS group_name,
          SUM(tokens_spent)::text                                       AS tokens_spent,
          SUM(tokens_saved_caching + tokens_saved_compression)::text    AS tokens_saved,
          COUNT(*)::text                                                AS query_count
        FROM token_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= NOW() - ${days} * INTERVAL '1 day'
        GROUP BY DATE_TRUNC(${trunc}, timestamp), COALESCE(tool_name, 'unknown')
        ORDER BY DATE_TRUNC(${trunc}, timestamp) DESC, group_name
      `;

      const bucketMap = new Map<string, BreakdownBucket>();
      const groupSet = new Set<string>();

      for (const r of rows) {
        groupSet.add(r.group_name);
        let bucket = bucketMap.get(r.bucket);
        if (!bucket) {
          bucket = { bucket: r.bucket, groups: {} };
          bucketMap.set(r.bucket, bucket);
        }
        bucket.groups[r.group_name] = {
          tokensSpent: parseInt(r.tokens_spent, 10),
          tokensSaved: parseInt(r.tokens_saved, 10),
          queryCount: parseInt(r.query_count, 10),
        };
      }

      const summary: BreakdownSummary = {
        buckets: Array.from(bucketMap.values()),
        groupNames: Array.from(groupSet).sort(),
        granularity,
        groupBy,
      };

      log.info('Analytics breakdown fetched', { workspaceId, granularity, groupBy, buckets: summary.buckets.length });
      return c.json({ data: summary });
    } catch (e) {
      log.error('Failed to fetch breakdown analytics', { error: e, workspaceId });
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch analytics breakdown' } },
        500,
      );
    }
  });

  return routes;
}
