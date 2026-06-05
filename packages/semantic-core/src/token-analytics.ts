import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'token-analytics' });

type SqlClient = ReturnType<typeof postgres>;

export type TokenEventInput = {
  tokensSpent: number;
  tokensSavedByCaching: number;
  tokensSavedByCompression: number;
  toolName?: string;
  cacheHit?: boolean;
};

export type DailyTokenSummary = {
  date: string;
  tokensSpent: number;
  tokensSavedByCaching: number;
  tokensSavedByCompression: number;
  totalTokensSaved: number;
  queryCount: number;
  cacheHitRate: number;
};

export type TokenAnalyticsSummary = {
  days: DailyTokenSummary[];
  totals: {
    tokensSpent: number;
    tokensSaved: number;
    cacheHitRate: number;
    compressionRatio: number;
  };
};

type TokenEventRow = {
  date: string;
  tokens_spent: string;
  tokens_saved_caching: string;
  tokens_saved_compression: string;
  query_count: string;
  cache_hits: string;
};

/**
 * Records token usage and savings per workspace for analytics.
 * Persists to the token_events table and aggregates for the dashboard.
 */
export class TokenAnalytics {
  constructor(private readonly sql: SqlClient) {}

  /**
   * @param workspaceId - Tenant workspace
   * @param event - Token counts for this MCP query
   */
  async logQuery(workspaceId: string, event: TokenEventInput): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO token_events
          (workspace_id, tokens_spent, tokens_saved_caching, tokens_saved_compression, tool_name, cache_hit)
        VALUES
          (${workspaceId}, ${event.tokensSpent}, ${event.tokensSavedByCaching},
           ${event.tokensSavedByCompression}, ${event.toolName ?? null}, ${event.cacheHit ?? false})
      `;
      log.debug('Token event logged', { workspaceId, tokensSpent: event.tokensSpent });
      return ok(undefined);
    } catch (e) {
      log.error('Failed to log token event', { error: e, workspaceId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns daily aggregated token spend and savings for the past N days.
   *
   * @param workspaceId - Tenant workspace
   * @param days - Number of days to include (default 30)
   */
  async getAnalytics(
    workspaceId: string,
    days = 30,
  ): Promise<Result<TokenAnalyticsSummary, Error>> {
    try {
      const rows = await this.sql<TokenEventRow[]>`
        SELECT
          DATE(timestamp)::text                                   AS date,
          SUM(tokens_spent)::text                                 AS tokens_spent,
          SUM(tokens_saved_caching)::text                         AS tokens_saved_caching,
          SUM(tokens_saved_compression)::text                     AS tokens_saved_compression,
          COUNT(*)::text                                          AS query_count,
          SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END)::text       AS cache_hits
        FROM token_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= NOW() - ${days} * INTERVAL '1 day'
        GROUP BY DATE(timestamp)
        ORDER BY DATE(timestamp) DESC
      `;

      const dailySummaries: DailyTokenSummary[] = rows.map((r) => {
        const spent = parseInt(r.tokens_spent, 10);
        const caching = parseInt(r.tokens_saved_caching, 10);
        const compression = parseInt(r.tokens_saved_compression, 10);
        const count = parseInt(r.query_count, 10);
        const hits = parseInt(r.cache_hits, 10);

        return {
          date: r.date,
          tokensSpent: spent,
          tokensSavedByCaching: caching,
          tokensSavedByCompression: compression,
          totalTokensSaved: caching + compression,
          queryCount: count,
          cacheHitRate: count > 0 ? hits / count : 0,
        };
      });

      const totalsSpent = dailySummaries.reduce((s, d) => s + d.tokensSpent, 0);
      const totalsSaved = dailySummaries.reduce((s, d) => s + d.totalTokensSaved, 0);
      const totalQueries = dailySummaries.reduce((s, d) => s + d.queryCount, 0);
      const totalHits = dailySummaries.reduce(
        (s, d) => s + Math.round(d.cacheHitRate * d.queryCount),
        0,
      );

      const compressionRatio =
        totalsSpent > 0 ? (totalsSpent + totalsSaved) / totalsSpent : 1;

      return ok({
        days: dailySummaries,
        totals: {
          tokensSpent: totalsSpent,
          tokensSaved: totalsSaved,
          cacheHitRate: totalQueries > 0 ? totalHits / totalQueries : 0,
          compressionRatio,
        },
      });
    } catch (e) {
      log.error('Failed to get token analytics', { error: e, workspaceId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
