import { ok, err, type Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ module: 'cost-optimizer' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Constants ────────────────────────────────────────────────────────────────

const COST_PER_1K_TOKENS_CENTS = 1.5;
const LOW_CACHE_HIT_RATE = 0.15;
const LOW_BUDGET_UTILIZATION = 0.30;
const STALE_ENTITY_DAYS = 90;
const OVERLAP_SIMILARITY_THRESHOLD = 0.90;
const LOW_EFFORT_SAVINGS_THRESHOLD_CENTS = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecommendationType =
  | 'enable_semantic_cache'
  | 'tune_context_budget'
  | 'consolidate_low_roi_connectors'
  | 'archive_stale_entities'
  | 'upgrade_embedding_model';

export type ImplementationEffort = 'low' | 'medium' | 'high';

export interface CostRecommendation {
  id: string;
  type: RecommendationType;
  title: string;
  description: string;
  estimatedSavingsTokensPerDay: number;
  estimatedSavingsCostMonthly: number;
  implementationEffort: ImplementationEffort;
  appliedAt: Date | null;
  savingsRealizedCents: number;
}

export interface SpendPattern {
  workspaceId: string;
  windowDays: number;
  totalTokensSpent: number;
  totalCostCents: number;
  avgTokensPerQuery: number;
  avgCostPerQuery: number;
  cacheHitRate: number;
  compressionEfficiency: number;
  tokensPerDay: number;
  costPerDay: number;
  topQueriesByTokens: Array<{ toolName: string; totalTokens: number; callCount: number }>;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Computes estimated monthly cost savings in cents from token savings per day.
 * @param tokenSavingsPerDay - Daily token reduction
 * @returns Estimated monthly savings in cents
 */
export function estimateMonthlySavings(tokenSavingsPerDay: number): number {
  return Math.round((tokenSavingsPerDay / 1000) * COST_PER_1K_TOKENS_CENTS * 30);
}

/**
 * Ranks recommendations by estimated monthly savings descending.
 * @param recommendations - Unsorted list
 * @returns Sorted copy
 */
export function rankRecommendations(recommendations: CostRecommendation[]): CostRecommendation[] {
  return [...recommendations].sort(
    (a, b) => b.estimatedSavingsCostMonthly - a.estimatedSavingsCostMonthly,
  );
}

/**
 * Returns only recommendations that have low implementation effort.
 * @param recommendations - Full list
 * @returns Filtered low-effort recommendations
 */
export function filterLowEffort(recommendations: CostRecommendation[]): CostRecommendation[] {
  return recommendations.filter((r) => r.implementationEffort === 'low');
}

// ─── Class ────────────────────────────────────────────────────────────────────

/**
 * Analyzes workspace spending patterns and produces actionable cost optimization recommendations.
 */
export class CostOptimizationAdvisor {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Analyzes token spend, cache efficiency, and connector costs over a time window.
   * @param workspaceId - Workspace to analyze
   * @param windowDays - Lookback window in days (default 30)
   * @returns Spend analysis summary
   */
  async analyzeSpendPatterns(
    workspaceId: string,
    windowDays = 30,
  ): Promise<Result<SpendPattern, Error>> {
    try {
      const rows = await this.sql`
        SELECT
          SUM(tokens_spent)                    AS total_tokens_spent,
          SUM(tokens_saved_caching)            AS total_tokens_saved_caching,
          SUM(tokens_saved_compression)        AS total_tokens_saved_compression,
          COUNT(*)                             AS query_count,
          AVG(tokens_spent)                    AS avg_tokens_per_query,
          SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) AS cache_hit_rate
        FROM token_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= NOW() - make_interval(days => ${windowDays})
      `;

      const topRows = await this.sql`
        SELECT
          COALESCE(tool_name, 'unknown') AS tool_name,
          SUM(tokens_spent)              AS total_tokens,
          COUNT(*)                       AS call_count
        FROM token_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= NOW() - make_interval(days => ${windowDays})
        GROUP BY tool_name
        ORDER BY SUM(tokens_spent) DESC
        LIMIT 5
      `;

      const r = rows[0] as {
        total_tokens_spent: string | null;
        total_tokens_saved_caching: string | null;
        total_tokens_saved_compression: string | null;
        query_count: string | null;
        avg_tokens_per_query: string | null;
        cache_hit_rate: string | null;
      };

      const totalTokensSpent = Number(r?.total_tokens_spent ?? 0);
      const queryCount = Number(r?.query_count ?? 0);
      const avgTokensPerQuery = Number(r?.avg_tokens_per_query ?? 0);
      const cacheHitRate = Number(r?.cache_hit_rate ?? 0);
      const tokensSavedCompression = Number(r?.total_tokens_saved_compression ?? 0);
      const totalTokensSaved = Number(r?.total_tokens_saved_caching ?? 0) + tokensSavedCompression;
      const compressionEfficiency =
        totalTokensSpent + totalTokensSaved > 0
          ? tokensSavedCompression / (totalTokensSpent + totalTokensSaved)
          : 0;

      const totalCostCents = (totalTokensSpent / 1000) * COST_PER_1K_TOKENS_CENTS;
      const avgCostPerQuery = queryCount > 0 ? totalCostCents / queryCount : 0;

      const topQueriesByTokens = (topRows as unknown as Array<{
        tool_name: string;
        total_tokens: string;
        call_count: string;
      }>).map((row) => ({
        toolName: row.tool_name,
        totalTokens: Number(row.total_tokens),
        callCount: Number(row.call_count),
      }));

      const pattern: SpendPattern = {
        workspaceId,
        windowDays,
        totalTokensSpent,
        totalCostCents,
        avgTokensPerQuery,
        avgCostPerQuery,
        cacheHitRate,
        compressionEfficiency,
        tokensPerDay: windowDays > 0 ? totalTokensSpent / windowDays : 0,
        costPerDay: windowDays > 0 ? totalCostCents / windowDays : 0,
        topQueriesByTokens,
      };

      log.info('Spend analysis complete', {
        workspaceId,
        windowDays,
        totalCostCents,
        cacheHitRate,
      });

      return ok(pattern);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to analyze spend patterns', { workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Generates ranked cost optimization recommendations based on current spend patterns.
   * @param pattern - Output from analyzeSpendPatterns
   * @returns Ordered list of recommendations with savings estimates
   */
  async generateRecommendations(
    pattern: SpendPattern,
  ): Promise<Result<CostRecommendation[], Error>> {
    try {
      const recommendations: CostRecommendation[] = [];

      if (pattern.cacheHitRate < LOW_CACHE_HIT_RATE && pattern.tokensPerDay > 0) {
        const potentialSavingsTokensPerDay = pattern.tokensPerDay * 0.3;
        recommendations.push({
          id: 'enable_semantic_cache',
          type: 'enable_semantic_cache',
          title: 'Enable or tune semantic cache',
          description: `Your cache hit rate is ${Math.round(pattern.cacheHitRate * 100)}% — below the 15% target. Enabling semantic cache can reduce repeat query costs by ~30%.`,
          estimatedSavingsTokensPerDay: Math.round(potentialSavingsTokensPerDay),
          estimatedSavingsCostMonthly: estimateMonthlySavings(potentialSavingsTokensPerDay),
          implementationEffort: 'low',
          appliedAt: null,
          savingsRealizedCents: 0,
        });
      }

      if (pattern.avgTokensPerQuery > 0 && pattern.avgTokensPerQuery < LOW_BUDGET_UTILIZATION * 2000) {
        const potentialSavingsTokensPerDay = pattern.tokensPerDay * 0.15;
        recommendations.push({
          id: 'tune_context_budget',
          type: 'tune_context_budget',
          title: 'Reduce context budget',
          description: `Average query uses ${Math.round(pattern.avgTokensPerQuery)} tokens — well under the 2000-token budget. Lowering the budget limit reduces per-query cost without impacting quality.`,
          estimatedSavingsTokensPerDay: Math.round(potentialSavingsTokensPerDay),
          estimatedSavingsCostMonthly: estimateMonthlySavings(potentialSavingsTokensPerDay),
          implementationEffort: 'low',
          appliedAt: null,
          savingsRealizedCents: 0,
        });
      }

      const staleEntityCount = await this.getStaleEntityCount(pattern.workspaceId);
      if (staleEntityCount > 0) {
        const savingsPerDay = (staleEntityCount * 0.0001 * COST_PER_1K_TOKENS_CENTS) / 30;
        recommendations.push({
          id: 'archive_stale_entities',
          type: 'archive_stale_entities',
          title: `Archive ${staleEntityCount.toLocaleString()} stale entities`,
          description: `${staleEntityCount} entities haven't been queried in ${STALE_ENTITY_DAYS}+ days. Archiving them reduces index size and embedding recompute costs.`,
          estimatedSavingsTokensPerDay: 0,
          estimatedSavingsCostMonthly: Math.round(savingsPerDay * 30 * 100),
          implementationEffort: 'medium',
          appliedAt: null,
          savingsRealizedCents: 0,
        });
      }

      recommendations.push({
        id: 'consolidate_low_roi_connectors',
        type: 'consolidate_low_roi_connectors',
        title: 'Review low-ROI connectors',
        description: 'Connectors with high index cost and low query volume inflate your total spend. Disable connectors with fewer than 1 query per dollar spent.',
        estimatedSavingsTokensPerDay: 0,
        estimatedSavingsCostMonthly: 0,
        implementationEffort: 'medium',
        appliedAt: null,
        savingsRealizedCents: 0,
      });

      const ranked = rankRecommendations(recommendations);
      log.info('Recommendations generated', {
        workspaceId: pattern.workspaceId,
        count: ranked.length,
      });

      return ok(ranked);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to generate recommendations', { workspaceId: pattern.workspaceId, error: error.message });
      return err(error);
    }
  }

  /**
   * Persists a recommendation as applied and records the realized savings.
   * @param workspaceId - Workspace identifier
   * @param recommendationId - Recommendation type/id to mark as applied
   * @param savingsRealizedCents - Actual savings achieved
   */
  async applyRecommendation(
    workspaceId: string,
    recommendationId: string,
    savingsRealizedCents = 0,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO cost_optimization_recommendations
          (workspace_id, recommendation_id, type, estimated_savings_cents, applied_at, savings_realized_cents)
        VALUES
          (${workspaceId}, ${recommendationId}, ${recommendationId}, ${savingsRealizedCents}, NOW(), ${savingsRealizedCents})
        ON CONFLICT (workspace_id, recommendation_id)
          DO UPDATE SET applied_at = NOW(), savings_realized_cents = ${savingsRealizedCents}
      `;

      log.info('Recommendation applied', { workspaceId, recommendationId, savingsRealizedCents });
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to apply recommendation', { workspaceId, recommendationId, error: error.message });
      return err(error);
    }
  }

  /**
   * Record a single context cost event for attribution analysis.
   * Stores query hash, entity breakdown, and token spend in context_cost_events.
   *
   * @param params - Context cost event data
   */
  async trackContextSize(params: {
    workspaceId: string;
    query: string;
    entities: Array<{ id: string; type: string; sourceConnectorId?: string }>;
    tokensSpent: number;
    tokensSaved: number;
    cacheHit: boolean;
  }): Promise<void> {
    const crypto = await import('node:crypto');
    const queryHash = crypto.createHash('sha256').update(params.query).digest('hex').slice(0, 16);

    const sourceConnectors = [...new Set(params.entities.map((e) => e.sourceConnectorId).filter((s): s is string => s != null))];
    const entityTypes = [...new Set(params.entities.map((e) => e.type))];

    await this.sql`
      INSERT INTO context_cost_events
        (workspace_id, query_hash, entities_returned, tokens_spent, tokens_saved, cache_hit, source_connectors, entity_types, timestamp)
      VALUES
        (${params.workspaceId}, ${queryHash}, ${params.entities.length}, ${params.tokensSpent},
         ${params.tokensSaved}, ${params.cacheHit}, ${sourceConnectors}, ${entityTypes}, now())
    `;
  }

  /**
   * Break down token costs by connector, entity type, and query pattern over a time window.
   *
   * @param workspaceId - Workspace to analyze
   * @param windowDays  - Lookback period in days (default: 30)
   */
  async attributeCosts(workspaceId: string, windowDays = 30): Promise<{
    byConnector: Array<{ connectorId: string; tokensSpent: number; pctOfTotal: number }>;
    byEntityType: Array<{ entityType: string; tokensSpent: number; pctOfTotal: number }>;
    weekOverWeekChange: number;
  }> {
    const [connectorRows, typeRows, currentWeekRows, prevWeekRows] = await Promise.all([
      this.sql<Array<{ connector_id: string; tokens_spent: string }>>`
        SELECT
          unnest(source_connectors) AS connector_id,
          SUM(tokens_spent)::text   AS tokens_spent
        FROM context_cost_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= now() - (${windowDays} || ' days')::interval
        GROUP BY 1
        ORDER BY SUM(tokens_spent) DESC
        LIMIT 20
      `,
      this.sql<Array<{ entity_type: string; tokens_spent: string }>>`
        SELECT
          unnest(entity_types) AS entity_type,
          SUM(tokens_spent)::text AS tokens_spent
        FROM context_cost_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= now() - (${windowDays} || ' days')::interval
        GROUP BY 1
        ORDER BY SUM(tokens_spent) DESC
        LIMIT 20
      `,
      this.sql<Array<{ total: string }>>`
        SELECT COALESCE(SUM(tokens_spent), 0)::text AS total
        FROM context_cost_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= now() - '7 days'::interval
      `,
      this.sql<Array<{ total: string }>>`
        SELECT COALESCE(SUM(tokens_spent), 0)::text AS total
        FROM context_cost_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= now() - '14 days'::interval
          AND timestamp < now() - '7 days'::interval
      `,
    ]);

    const totalConnector = connectorRows.reduce((s, r) => s + parseInt(r.tokens_spent, 10), 0) || 1;
    const totalType = typeRows.reduce((s, r) => s + parseInt(r.tokens_spent, 10), 0) || 1;
    const currentWeek = parseInt(currentWeekRows[0]?.total ?? '0', 10);
    const prevWeek = parseInt(prevWeekRows[0]?.total ?? '0', 10);
    const weekOverWeekChange = prevWeek > 0 ? ((currentWeek - prevWeek) / prevWeek) * 100 : 0;

    if (weekOverWeekChange > 20) {
      log.warn('Week-over-week token cost increased >20%', {
        workspaceId,
        currentWeek,
        prevWeek,
        changePct: weekOverWeekChange.toFixed(1),
      });
    }

    return {
      byConnector: connectorRows.map((r) => ({
        connectorId: r.connector_id,
        tokensSpent: parseInt(r.tokens_spent, 10),
        pctOfTotal: (parseInt(r.tokens_spent, 10) / totalConnector) * 100,
      })),
      byEntityType: typeRows.map((r) => ({
        entityType: r.entity_type,
        tokensSpent: parseInt(r.tokens_spent, 10),
        pctOfTotal: (parseInt(r.tokens_spent, 10) / totalType) * 100,
      })),
      weekOverWeekChange,
    };
  }

  /**
   * Convenience wrapper: analyze patterns then generate ranked recommendations.
   *
   * @param workspaceId - Workspace to analyze
   * @param windowDays  - Lookback period (default: 30)
   */
  async recommend(workspaceId: string, windowDays = 30): Promise<Result<CostRecommendation[], Error>> {
    const patternResult = await this.analyzeSpendPatterns(workspaceId, windowDays);
    if (patternResult.isErr()) return err(patternResult.error);
    return this.generateRecommendations(patternResult.value);
  }

  private async getStaleEntityCount(workspaceId: string): Promise<number> {
    try {
      const rows = await this.sql`
        SELECT COUNT(DISTINCT te.id) AS stale_count
        FROM token_events te
        WHERE te.workspace_id = ${workspaceId}
          AND te.timestamp < NOW() - make_interval(days => ${STALE_ENTITY_DAYS})
          AND NOT EXISTS (
            SELECT 1 FROM token_events te2
            WHERE te2.workspace_id = te.workspace_id
              AND te2.timestamp > NOW() - make_interval(days => ${STALE_ENTITY_DAYS})
          )
        LIMIT 1
      `;
      return Number((rows[0] as { stale_count: string })?.stale_count ?? 0);
    } catch {
      return 0;
    }
  }
}
