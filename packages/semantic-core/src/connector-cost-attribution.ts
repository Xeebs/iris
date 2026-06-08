import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'connector-cost-attribution' });

type SqlClient = ReturnType<typeof postgres>;

// Cost constants — derived from embedding-patterns.md and public model pricing (mid-2026)
/** text-embedding-3-small: ~$0.02 / 1M tokens; avg entity ~50 tokens → $0.000001 per entity */
const INDEX_COST_CENTS_PER_ENTITY = 0.0001; // $0.000001 in cents
/** pgvector storage: ~$0.00004 per KB */
const STORAGE_COST_CENTS_PER_KB = 0.004;
/** Average query tokens ~500; gpt-4o-mini: ~$0.15/1M output → ~$0.000075 per query */
const QUERY_COST_CENTS_PER_1K_TOKENS = 0.015;

export type CostEventType = 'entity_indexed' | 'query_executed';

export interface ConnectorCostSummary {
  connectorId: string;
  entityCount: number;
  indexCostCents: number;
  queryCostCents: number;
  totalCostCents: number;
  tokensSpent: number;
  tokensSaved: number;
  queryCount: number;
  roiScore: number; // queries per dollar spent
}

export interface CostBreakdownReport {
  workspaceId: string;
  periodStart: Date;
  periodEnd: Date;
  totalCostCents: number;
  connectors: ConnectorCostSummary[];
  recommendations: CostRecommendation[];
}

export interface CostRecommendation {
  type: 'disable_low_roi' | 'consolidate_overlap' | 'archive_stale';
  connectorId: string;
  title: string;
  description: string;
  estimatedSavingsCentsPerMonth: number;
}

type DailyRow = {
  connector_id: string;
  entity_count_indexed: string | number;
  index_cost_cents: string | number;
  query_count: string | number;
  query_cost_cents: string | number;
  tokens_spent: string | number;
  tokens_saved: string | number;
};

// ─── Cost calculation helpers ─────────────────────────────────────────────────

/**
 * Compute indexing cost in cents for a batch of entities.
 *
 * @param entityCount - Number of entities indexed
 * @param storedKb - Approximate storage in kilobytes
 * @returns Cost in cents
 */
export function computeIndexCostCents(entityCount: number, storedKb = 0): number {
  const embeddingCost = entityCount * INDEX_COST_CENTS_PER_ENTITY;
  const storageCost = storedKb * STORAGE_COST_CENTS_PER_KB;
  return Math.round((embeddingCost + storageCost) * 10000) / 10000;
}

/**
 * Compute query cost in cents based on tokens consumed.
 *
 * @param tokensConsumed - Tokens used in the query (input + output)
 * @returns Cost in cents
 */
export function computeQueryCostCents(tokensConsumed: number): number {
  return Math.round((tokensConsumed / 1000) * QUERY_COST_CENTS_PER_1K_TOKENS * 10000) / 10000;
}

/**
 * Compute ROI score: queries per dollar spent (higher = better).
 * Returns Infinity when cost is 0 (free connector).
 *
 * @param queryCount - Number of queries attributed to the connector
 * @param totalCostCents - Total cost in cents
 * @returns ROI score (queries per dollar)
 */
export function computeRoiScore(queryCount: number, totalCostCents: number): number {
  if (totalCostCents === 0) return queryCount > 0 ? Infinity : 0;
  return Math.round((queryCount / (totalCostCents / 100)) * 100) / 100;
}

// ─── ConnectorCostAttributor ──────────────────────────────────────────────────

/**
 * Tracks and reports costs per connector, enabling ROI analysis and data-driven
 * decisions about which integrations deliver value.
 */
export class ConnectorCostAttributor {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Record a cost event for a connector.
   * Also upserts into the daily aggregation table for fast reporting.
   *
   * @param workspaceId - Tenant workspace
   * @param connectorId - Connector instance ID
   * @param eventType - Type of event: 'entity_indexed' or 'query_executed'
   * @param quantity - Units consumed (entity count or query count)
   * @param costCents - Cost in cents for this event
   * @param tokensSpent - Tokens consumed (for query events)
   * @param tokensSaved - Tokens saved by caching (for query events)
   */
  async recordConnectorCost(
    workspaceId: string,
    connectorId: string,
    eventType: CostEventType,
    quantity: number,
    costCents: number,
    tokensSpent = 0,
    tokensSaved = 0,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO connector_cost_attribution
          (workspace_id, connector_id, event_type, quantity, cost_cents, tokens_spent, tokens_saved)
        VALUES
          (${workspaceId}, ${connectorId}, ${eventType}, ${quantity}, ${costCents}, ${tokensSpent}, ${tokensSaved})
      `;

      const entityCountIndexed = eventType === 'entity_indexed' ? quantity : 0;
      const indexCost = eventType === 'entity_indexed' ? costCents : 0;
      const queryCount = eventType === 'query_executed' ? quantity : 0;
      const queryCost = eventType === 'query_executed' ? costCents : 0;

      await this.sql`
        INSERT INTO connector_cost_daily
          (workspace_id, connector_id, date, entity_count_indexed, index_cost_cents,
           query_count, query_cost_cents, tokens_spent, tokens_saved)
        VALUES
          (${workspaceId}, ${connectorId}, CURRENT_DATE, ${entityCountIndexed}, ${indexCost},
           ${queryCount}, ${queryCost}, ${tokensSpent}, ${tokensSaved})
        ON CONFLICT (workspace_id, connector_id, date)
        DO UPDATE SET
          entity_count_indexed = connector_cost_daily.entity_count_indexed + EXCLUDED.entity_count_indexed,
          index_cost_cents     = connector_cost_daily.index_cost_cents     + EXCLUDED.index_cost_cents,
          query_count          = connector_cost_daily.query_count          + EXCLUDED.query_count,
          query_cost_cents     = connector_cost_daily.query_cost_cents     + EXCLUDED.query_cost_cents,
          tokens_spent         = connector_cost_daily.tokens_spent         + EXCLUDED.tokens_spent,
          tokens_saved         = connector_cost_daily.tokens_saved         + EXCLUDED.tokens_saved,
          updated_at           = NOW()
      `;

      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to record connector cost', { workspaceId, connectorId, eventType, error: error.message });
      return err(error);
    }
  }

  /**
   * Aggregate costs by connector for a given time period.
   * Returns summaries ranked by total cost (highest first).
   *
   * @param workspaceId - Tenant workspace
   * @param periodStart - Start of reporting period
   * @param periodEnd - End of reporting period
   * @returns CostBreakdownReport with per-connector summaries and recommendations
   */
  async aggregateByConnector(
    workspaceId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Result<CostBreakdownReport, Error>> {
    try {
      const rows = await this.sql<DailyRow[]>`
        SELECT
          connector_id,
          SUM(entity_count_indexed)::INTEGER AS entity_count_indexed,
          SUM(index_cost_cents)              AS index_cost_cents,
          SUM(query_count)::INTEGER          AS query_count,
          SUM(query_cost_cents)              AS query_cost_cents,
          SUM(tokens_spent)::INTEGER         AS tokens_spent,
          SUM(tokens_saved)::INTEGER         AS tokens_saved
        FROM connector_cost_daily
        WHERE workspace_id = ${workspaceId}
          AND date BETWEEN ${periodStart} AND ${periodEnd}
        GROUP BY connector_id
        ORDER BY (SUM(index_cost_cents) + SUM(query_cost_cents)) DESC
      `;

      const connectors: ConnectorCostSummary[] = rows.map((row) => {
        const indexCostCents = Number(row.index_cost_cents);
        const queryCostCents = Number(row.query_cost_cents);
        const totalCostCents = indexCostCents + queryCostCents;
        const queryCount = Number(row.query_count);

        return {
          connectorId: row.connector_id,
          entityCount: Number(row.entity_count_indexed),
          indexCostCents,
          queryCostCents,
          totalCostCents,
          tokensSpent: Number(row.tokens_spent),
          tokensSaved: Number(row.tokens_saved),
          queryCount,
          roiScore: computeRoiScore(queryCount, totalCostCents),
        };
      });

      const totalCostCents = connectors.reduce((sum, c) => sum + c.totalCostCents, 0);
      const recommendations = generateRecommendations(connectors, totalCostCents);

      log.info('Cost breakdown computed', {
        workspaceId,
        connectorCount: connectors.length,
        totalCostCents,
      });

      return ok({ workspaceId, periodStart, periodEnd, totalCostCents, connectors, recommendations });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to aggregate connector costs', { workspaceId, error: error.message });
      return err(error);
    }
  }
}

// ─── Recommendation engine ─────────────────────────────────────────────────

const LOW_ROI_THRESHOLD = 1; // < 1 query per dollar spent
const LOW_ROI_MIN_COST_CENTS = 100; // only flag connectors that cost at least $1

function generateRecommendations(
  connectors: ConnectorCostSummary[],
  totalCostCents: number,
): CostRecommendation[] {
  const recommendations: CostRecommendation[] = [];

  for (const connector of connectors) {
    if (
      connector.totalCostCents >= LOW_ROI_MIN_COST_CENTS &&
      connector.roiScore < LOW_ROI_THRESHOLD &&
      connector.queryCount === 0
    ) {
      recommendations.push({
        type: 'disable_low_roi',
        connectorId: connector.connectorId,
        title: `Disable low-ROI connector: ${connector.connectorId}`,
        description: `This connector costs $${(connector.totalCostCents / 100).toFixed(2)} but has generated 0 queries. Consider disabling it to save costs.`,
        estimatedSavingsCentsPerMonth: Math.round(connector.totalCostCents * 30),
      });
    }
  }

  const highCostConnectors = connectors.filter(
    (c) => totalCostCents > 0 && c.totalCostCents / totalCostCents > 0.5,
  );

  for (const connector of highCostConnectors) {
    if (connector.entityCount > 10_000) {
      recommendations.push({
        type: 'archive_stale',
        connectorId: connector.connectorId,
        title: `Archive stale entities from ${connector.connectorId}`,
        description: `${connector.connectorId} has ${connector.entityCount.toLocaleString()} indexed entities. Archiving entities not queried in 90 days could reduce indexing and storage costs by up to 30%.`,
        estimatedSavingsCentsPerMonth: Math.round(connector.indexCostCents * 0.3 * 30),
      });
    }
  }

  return recommendations.sort((a, b) => b.estimatedSavingsCentsPerMonth - a.estimatedSavingsCentsPerMonth);
}
