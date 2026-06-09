import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'cost-attribution' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type CostPeriod = 'day' | 'week' | 'month';

export type EntityCostEntry = {
  queryId: string;
  entityId: string;
  tokensUsed: number;
  computeMs: number;
  recordedAt: Date;
};

export type EntityCostBreakdown = {
  entityId: string;
  totalTokens: number;
  totalComputeMs: number;
  queryCount: number;
  estimatedCostUsd: number;
};

export type ConnectorCostSummary = {
  connectorId: string;
  period: CostPeriod;
  apiCallCount: number;
  tokensIndexed: number;
  tokensRetrieved: number;
  estimatedCostUsd: number;
};

export type UserCostLedger = {
  userId: string;
  period: CostPeriod;
  queryCount: number;
  totalTokens: number;
  estimatedCostUsd: number;
  byConnector: { connectorId: string; tokens: number; costUsd: number }[];
};

export type CostForecast = {
  entityId: string;
  interval: CostPeriod;
  forecastedTokens: number;
  forecastedCostUsd: number;
  confidenceLevel: 'low' | 'medium' | 'high';
  basedOnDays: number;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const TOKEN_COST_PER_MILLION = 0.02; // text-embedding-3-small rate

/**
 * Convert token count to estimated cost in USD.
 * @param tokens - Number of tokens
 * @returns Estimated cost in USD
 */
export function tokensToUsd(tokens: number): number {
  return (tokens / 1_000_000) * TOKEN_COST_PER_MILLION;
}

/**
 * Select the number of historical days to query based on period.
 * @param period - Cost aggregation period
 * @returns Number of days
 */
export function periodToDays(period: CostPeriod): number {
  switch (period) {
    case 'day': return 1;
    case 'week': return 7;
    case 'month': return 30;
  }
}

/**
 * Estimate forecast confidence based on sample count.
 * @param sampleCount - Number of historical data points
 * @returns Confidence level
 */
export function estimateForecastConfidence(sampleCount: number): CostForecast['confidenceLevel'] {
  if (sampleCount >= 14) return 'high';
  if (sampleCount >= 5) return 'medium';
  return 'low';
}

/**
 * Project future token usage using a simple linear extrapolation from historical average.
 * @param historicalDailyAvg - Average tokens per day from history
 * @param days - Number of days to forecast
 * @returns Forecasted total tokens
 */
export function forecastTokens(historicalDailyAvg: number, days: number): number {
  return Math.round(historicalDailyAvg * days);
}

// ─── CostAttributor ───────────────────────────────────────────────────────────

export class CostAttributor {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Record the cost contribution of a specific entity in a query.
   * @param queryId - Query that retrieved the entity
   * @param entityId - Entity whose context was included
   * @param tokensUsed - Tokens consumed by this entity's context
   * @param computeMs - Milliseconds of compute attributed to this entity
   */
  async attributeCostToEntity(
    queryId: string,
    entityId: string,
    tokensUsed: number,
    computeMs: number,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO entity_cost_attribution (id, query_id, entity_id, tokens_used, compute_ms, recorded_at)
        VALUES (${randomUUID()}, ${queryId}, ${entityId}, ${tokensUsed}, ${computeMs}, NOW())
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the cost breakdown for a specific entity over all queries.
   * @param entityId - Target entity ID
   */
  async getEntityCostBreakdown(entityId: string): Promise<Result<EntityCostBreakdown, Error>> {
    try {
      type Row = { total_tokens: number; total_compute_ms: number; query_count: number };
      const [row] = await this.sql<Row[]>`
        SELECT SUM(tokens_used)::int AS total_tokens,
               SUM(compute_ms)::int AS total_compute_ms,
               COUNT(DISTINCT query_id)::int AS query_count
        FROM entity_cost_attribution
        WHERE entity_id = ${entityId}
      `;
      const totalTokens = row?.total_tokens ?? 0;
      const totalComputeMs = row?.total_compute_ms ?? 0;
      const queryCount = row?.query_count ?? 0;
      return ok({
        entityId,
        totalTokens,
        totalComputeMs,
        queryCount,
        estimatedCostUsd: tokensToUsd(totalTokens),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Aggregate sync and retrieval costs for a connector over a time period.
   * @param connectorId - Target connector ID
   * @param period - Aggregation period
   */
  async computeConnectorCost(connectorId: string, period: CostPeriod): Promise<Result<ConnectorCostSummary, Error>> {
    const days = periodToDays(period);
    try {
      type Row = { api_call_count: number; tokens_indexed: number; tokens_retrieved: number };
      const [row] = await this.sql<Row[]>`
        SELECT SUM(api_call_count)::int AS api_call_count,
               SUM(tokens_indexed)::int AS tokens_indexed,
               SUM(tokens_retrieved)::int AS tokens_retrieved
        FROM connector_cost_events
        WHERE connector_id = ${connectorId}
          AND recorded_at >= NOW() - INTERVAL '1 day' * ${days}
      `;
      const apiCallCount = row?.api_call_count ?? 0;
      const tokensIndexed = row?.tokens_indexed ?? 0;
      const tokensRetrieved = row?.tokens_retrieved ?? 0;
      const totalTokens = tokensIndexed + tokensRetrieved;
      log.debug('Connector cost computed', { connectorId, period, totalTokens });
      return ok({
        connectorId,
        period,
        apiCallCount,
        tokensIndexed,
        tokensRetrieved,
        estimatedCostUsd: tokensToUsd(totalTokens),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Aggregate all query costs for a user over a time period, broken down by connector.
   * @param userId - Target user ID
   * @param period - Aggregation period
   */
  async aggregateUserCosts(userId: string, period: CostPeriod): Promise<Result<UserCostLedger, Error>> {
    const days = periodToDays(period);
    try {
      type SummaryRow = { query_count: number; total_tokens: number };
      type ByConnectorRow = { connector_id: string; tokens: number };

      const [summary] = await this.sql<SummaryRow[]>`
        SELECT COUNT(DISTINCT query_id)::int AS query_count,
               SUM(tokens_used)::int AS total_tokens
        FROM user_cost_ledger
        WHERE user_id = ${userId}
          AND recorded_at >= NOW() - INTERVAL '1 day' * ${days}
      `;
      const byConnectorRows = await this.sql<ByConnectorRow[]>`
        SELECT connector_id, SUM(tokens_used)::int AS tokens
        FROM user_cost_ledger
        WHERE user_id = ${userId}
          AND recorded_at >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY connector_id
      `;

      const totalTokens = summary?.total_tokens ?? 0;
      return ok({
        userId,
        period,
        queryCount: summary?.query_count ?? 0,
        totalTokens,
        estimatedCostUsd: tokensToUsd(totalTokens),
        byConnector: byConnectorRows.map((r) => ({
          connectorId: r.connector_id,
          tokens: r.tokens,
          costUsd: tokensToUsd(r.tokens),
        })),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Predict future retrieval costs for an entity based on historical access patterns.
   * @param entityId - Target entity
   * @param interval - Forecast period
   */
  async computeCostForecast(entityId: string, interval: CostPeriod): Promise<Result<CostForecast, Error>> {
    const forecastDays = periodToDays(interval);
    try {
      type Row = { day: string; daily_tokens: number };
      const rows = await this.sql<Row[]>`
        SELECT DATE_TRUNC('day', recorded_at)::text AS day,
               SUM(tokens_used)::int AS daily_tokens
        FROM entity_cost_attribution
        WHERE entity_id = ${entityId}
          AND recorded_at >= NOW() - INTERVAL '30 days'
        GROUP BY day
        ORDER BY day ASC
      `;

      const basedOnDays = rows.length;
      const dailyAvg = basedOnDays > 0
        ? rows.reduce((s, r) => s + r.daily_tokens, 0) / basedOnDays
        : 0;

      const forecastedTokens = forecastTokens(dailyAvg, forecastDays);
      return ok({
        entityId,
        interval,
        forecastedTokens,
        forecastedCostUsd: tokensToUsd(forecastedTokens),
        confidenceLevel: estimateForecastConfidence(basedOnDays),
        basedOnDays,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record a connector sync event with associated costs.
   * @param connectorId - Connector that ran
   * @param apiCallCount - Number of API calls made
   * @param tokensIndexed - Tokens used for indexing
   * @param tokensRetrieved - Tokens used in retrieval queries
   */
  async recordConnectorEvent(
    connectorId: string,
    apiCallCount: number,
    tokensIndexed: number,
    tokensRetrieved: number,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO connector_cost_events (id, connector_id, api_call_count, tokens_indexed, tokens_retrieved, recorded_at)
        VALUES (${randomUUID()}, ${connectorId}, ${apiCallCount}, ${tokensIndexed}, ${tokensRetrieved}, NOW())
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
