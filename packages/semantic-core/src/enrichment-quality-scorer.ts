import { ok, err, type Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ module: 'enrichment-quality-scorer' });

// ─── Types ────────────────────────────────────────────────────────────────────

type CompletenessScore = {
  entityId: string;
  entityType: string;
  connectorId: string;
  completeness: number;
  requiredHitRate: number;
  populatedCount: number;
  totalAttributes: number;
  scoredAt: Date;
};

type EnrichmentMetrics = {
  connectorId: string;
  entityType: string;
  meanCompleteness: number;
  sourceDiversityEntropy: number;
  meanRefreshLagSec: number;
  entityCount: number;
};

type EnrichmentGap = {
  fieldName: string;
  entityType: string;
  connectorId: string;
  nullRate: number;
  nullCount: number;
  totalCount: number;
};

type SourceReliability = {
  sourceId: string;
  entityType: string;
  accuracyRating: number | null;
  confidenceAvg: number;
  feedbackCount: number;
};

type EnrichmentROI = {
  connectorId: string;
  period: string;
  totalTokenCost: number;
  entitiesEnriched: number;
  avgCompletenessGain: number;
  tokenPerEntity: number;
  completenessPerToken: number;
};

type EnrichmentError = { code: string; message: string };
type SqlClient = ReturnType<typeof postgres>;

// ─── EnrichmentQualityScorer ──────────────────────────────────────────────────

/**
 * Scores enrichment completeness, identifies coverage gaps, and measures source diversity.
 */
export class EnrichmentQualityScorer {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Scores attribute coverage for a single entity.
   * @param entityId - Entity to evaluate
   * @param workspaceId - Workspace scope
   * @returns Completeness score with populated/total attribute counts
   */
  async scoreEnrichmentCompletenessForEntity(
    entityId: string,
    workspaceId: string,
  ): Promise<Result<CompletenessScore, EnrichmentError>> {
    try {
      const rows = await this.sql<{
        entity_id: string;
        entity_type: string;
        connector_id: string;
        completeness: number;
        required_hit_rate: number;
        source_diversity: number;
        scored_at: Date;
      }[]>`
        SELECT entity_id, entity_type, connector_id, completeness, required_hit_rate, source_diversity, scored_at
        FROM enrichment_quality_scores
        WHERE entity_id = ${entityId} AND workspace_id = ${workspaceId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        return err({ code: 'NOT_FOUND', message: `No enrichment score for entity ${entityId}` });
      }

      const r = rows[0]!;
      const populated = Math.round((Number(r.completeness) / 100) * 10);
      const total = 10;

      return ok({
        entityId: r.entity_id,
        entityType: r.entity_type,
        connectorId: r.connector_id,
        completeness: Number(r.completeness),
        requiredHitRate: Number(r.required_hit_rate),
        populatedCount: populated,
        totalAttributes: total,
        scoredAt: r.scored_at,
      });
    } catch (e) {
      log.error('Failed to score entity completeness', { entityId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Computes aggregated enrichment metrics for a connector over a time period.
   * @param connectorId - Target connector
   * @param workspaceId - Workspace scope
   * @param period - ISO period string like 'P7D'
   * @returns Per-entity-type enrichment metrics
   */
  async aggregateEnrichmentMetrics(
    connectorId: string,
    workspaceId: string,
    period = 'P7D',
  ): Promise<Result<EnrichmentMetrics[], EnrichmentError>> {
    try {
      const intervalDays = parsePeriodToDays(period);
      const since = new Date(Date.now() - intervalDays * 86400 * 1000);

      const rows = await this.sql<{
        entity_type: string;
        mean_completeness: number;
        mean_diversity: number;
        mean_refresh_lag: number;
        entity_count: number;
      }[]>`
        SELECT
          entity_type,
          AVG(completeness)::NUMERIC AS mean_completeness,
          AVG(source_diversity)::NUMERIC AS mean_diversity,
          AVG(refresh_lag_sec)::NUMERIC AS mean_refresh_lag,
          COUNT(*)::INTEGER AS entity_count
        FROM enrichment_quality_scores
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND scored_at >= ${since}
        GROUP BY entity_type
        ORDER BY mean_completeness ASC
      `;

      return ok(
        rows.map((r) => ({
          connectorId,
          entityType: r.entity_type,
          meanCompleteness: Math.round(Number(r.mean_completeness) * 100) / 100,
          sourceDiversityEntropy: Math.round(Number(r.mean_diversity) * 10000) / 10000,
          meanRefreshLagSec: Math.round(Number(r.mean_refresh_lag)),
          entityCount: r.entity_count,
        })),
      );
    } catch (e) {
      log.error('Failed to aggregate enrichment metrics', { connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Detects systematically unenriched field patterns.
   * @param entityType - Entity type to analyse
   * @param connectorId - Source connector
   * @param workspaceId - Workspace scope
   * @param minNullRate - Minimum null rate to report (default: 0.5)
   * @returns Gaps ordered by frequency descending
   */
  async detectEnrichmentGaps(
    entityType: string,
    connectorId: string,
    workspaceId: string,
    minNullRate = 0.5,
  ): Promise<Result<EnrichmentGap[], EnrichmentError>> {
    try {
      const rows = await this.sql<{
        field_name: string;
        null_rate: number;
        null_count: number;
        total_count: number;
      }[]>`
        SELECT field_name, null_rate, null_count, total_count
        FROM enrichment_gaps
        WHERE entity_type = ${entityType}
          AND connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND null_rate >= ${minNullRate}
        ORDER BY null_rate DESC
        LIMIT 50
      `;

      return ok(
        rows.map((r) => ({
          fieldName: r.field_name,
          entityType,
          connectorId,
          nullRate: Number(r.null_rate),
          nullCount: r.null_count,
          totalCount: r.total_count,
        })),
      );
    } catch (e) {
      log.error('Failed to detect enrichment gaps', { entityType, connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Computes Shannon entropy of enrichment sources for an entity (higher = more diverse).
   * @param entityId - Entity to evaluate
   * @param workspaceId - Workspace scope
   * @returns Source diversity score 0–1
   */
  async scoreSourceDiversity(
    entityId: string,
    workspaceId: string,
  ): Promise<Result<{ entityId: string; entropy: number; sourceCount: number }, EnrichmentError>> {
    try {
      const rows = await this.sql<{ source_id: string; attribute_count: number }[]>`
        SELECT source_id, COUNT(*)::INTEGER AS attribute_count
        FROM entity_enrichment_sources
        WHERE entity_id = ${entityId} AND workspace_id = ${workspaceId}
        GROUP BY source_id
      `;

      if (rows.length === 0) {
        return ok({ entityId, entropy: 0, sourceCount: 0 });
      }

      const total = rows.reduce((sum, r) => sum + r.attribute_count, 0);
      const entropy = rows.reduce((sum, r) => {
        const p = r.attribute_count / total;
        return sum - (p > 0 ? p * Math.log2(p) : 0);
      }, 0);

      // Normalise to 0-1 by dividing by log2(N) where N is max possible sources
      const maxEntropy = rows.length > 1 ? Math.log2(rows.length) : 1;
      const normEntropy = maxEntropy > 0 ? Math.min(1, entropy / maxEntropy) : 0;

      return ok({
        entityId,
        entropy: Math.round(normEntropy * 10000) / 10000,
        sourceCount: rows.length,
      });
    } catch (e) {
      log.error('Failed to score source diversity', { entityId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Assesses enrichment ROI: token cost vs. completeness improvement for a connector.
   * @param connectorId - Target connector
   * @param workspaceId - Workspace scope
   * @param period - ISO period string like 'P7D'
   * @returns ROI metrics
   */
  async assessEnrichmentROI(
    connectorId: string,
    workspaceId: string,
    period = 'P7D',
  ): Promise<Result<EnrichmentROI, EnrichmentError>> {
    try {
      const intervalDays = parsePeriodToDays(period);
      const since = new Date(Date.now() - intervalDays * 86400 * 1000);

      const tokenRows = await this.sql<{ total_tokens: number; entity_count: number }[]>`
        SELECT
          COALESCE(SUM(token_cost), 0)::BIGINT AS total_tokens,
          COUNT(DISTINCT entity_id)::INTEGER AS entity_count
        FROM enrichment_audit_log
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND created_at >= ${since}
      `;

      const completenessRows = await this.sql<{ avg_gain: number }[]>`
        SELECT AVG(completeness_gain)::NUMERIC AS avg_gain
        FROM enrichment_audit_log
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND created_at >= ${since}
      `;

      const totalTokens = Number(tokenRows[0]?.total_tokens ?? 0);
      const entityCount = tokenRows[0]?.entity_count ?? 0;
      const avgGain = Number(completenessRows[0]?.avg_gain ?? 0);
      const tokenPerEntity = entityCount > 0 ? Math.round(totalTokens / entityCount) : 0;
      const completenessPerToken = totalTokens > 0 ? Math.round((avgGain / totalTokens) * 1000000) / 1000000 : 0;

      return ok({
        connectorId,
        period,
        totalTokenCost: totalTokens,
        entitiesEnriched: entityCount,
        avgCompletenessGain: Math.round(avgGain * 100) / 100,
        tokenPerEntity,
        completenessPerToken,
      });
    } catch (e) {
      log.error('Failed to assess enrichment ROI', { connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Gets source reliability feedback for a source ID.
   * @param sourceId - Source to query
   * @param workspaceId - Workspace scope
   * @returns Reliability record or NOT_FOUND error
   */
  async getSourceReliability(
    sourceId: string,
    workspaceId: string,
  ): Promise<Result<SourceReliability[], EnrichmentError>> {
    try {
      const rows = await this.sql<{
        entity_type: string;
        accuracy_rating: number | null;
        confidence_avg: number;
        feedback_count: number;
      }[]>`
        SELECT entity_type, accuracy_rating, confidence_avg, feedback_count
        FROM source_reliability_feedback
        WHERE source_id = ${sourceId} AND workspace_id = ${workspaceId}
        ORDER BY entity_type
      `;

      return ok(
        rows.map((r) => ({
          sourceId,
          entityType: r.entity_type,
          accuracyRating: r.accuracy_rating !== null ? Number(r.accuracy_rating) : null,
          confidenceAvg: Number(r.confidence_avg),
          feedbackCount: r.feedback_count,
        })),
      );
    } catch (e) {
      log.error('Failed to get source reliability', { sourceId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Records source reliability feedback from users.
   * @param sourceId - Source being rated
   * @param workspaceId - Workspace scope
   * @param entityType - Entity type this feedback applies to
   * @param accuracyRating - Rating 0–1
   */
  async recordSourceFeedback(
    sourceId: string,
    workspaceId: string,
    entityType: string,
    accuracyRating: number,
  ): Promise<Result<void, EnrichmentError>> {
    if (accuracyRating < 0 || accuracyRating > 1) {
      return err({ code: 'VALIDATION_ERROR', message: 'accuracyRating must be 0-1' });
    }

    try {
      await this.sql`
        INSERT INTO source_reliability_feedback
          (workspace_id, source_id, entity_type, accuracy_rating, feedback_count, last_feedback, updated_at)
        VALUES
          (${workspaceId}, ${sourceId}, ${entityType}, ${accuracyRating}, 1, NOW(), NOW())
        ON CONFLICT (workspace_id, source_id, entity_type) DO UPDATE SET
          accuracy_rating = (source_reliability_feedback.accuracy_rating * source_reliability_feedback.feedback_count + ${accuracyRating}) /
                            (source_reliability_feedback.feedback_count + 1),
          feedback_count  = source_reliability_feedback.feedback_count + 1,
          last_feedback   = NOW(),
          updated_at      = NOW()
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to record source feedback', { sourceId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePeriodToDays(period: string): number {
  const match = /^P(\d+)D$/.exec(period);
  if (match) return parseInt(match[1]!, 10);
  return 7;
}
