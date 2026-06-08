import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'relevance-tuner' });

export type ScoringFactorName =
  | 'bm25_weight'
  | 'embedding_weight'
  | 'type_boost_contact'
  | 'type_boost_deal'
  | 'type_boost_company'
  | 'recency_boost'
  | 'relationship_distance_penalty';

export interface ScoringWeights {
  bm25_weight: number;
  embedding_weight: number;
  type_boost_contact: number;
  type_boost_deal: number;
  type_boost_company: number;
  recency_boost: number;
  relationship_distance_penalty: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  bm25_weight: 0.3,
  embedding_weight: 0.7,
  type_boost_contact: 1.0,
  type_boost_deal: 1.0,
  type_boost_company: 1.0,
  recency_boost: 0.1,
  relationship_distance_penalty: 0.05,
};

export interface ScoredCandidate {
  entityId: string;
  entityType: string;
  embeddingScore: number;
  bm25Score?: number;
  lastModified?: Date;
  relationshipDistance?: number;
}

export interface SearchFeedback {
  workspaceId: string;
  query: string;
  clickedEntityId: string;
  rank: number;
  feedbackScore: number;
  dwellTimeMs?: number;
}

export interface TuningConfig {
  workspaceId: string;
  factorName: ScoringFactorName;
  tunedValue: number;
}

type SqlClient = ReturnType<typeof import('postgres').default>;

/**
 * Computes a blended relevance score for a search candidate.
 * Score = embedding_weight * cosine_sim + bm25_weight * bm25 + type_boost + recency_boost - relationship_penalty
 *
 * @param candidate - The entity and its raw scores
 * @param weights   - Blending weights for this workspace
 */
export function computeBlendedScore(candidate: ScoredCandidate, weights: ScoringWeights): number {
  let score = weights.embedding_weight * candidate.embeddingScore;

  if (candidate.bm25Score !== undefined) {
    score += weights.bm25_weight * candidate.bm25Score;
  }

  const typeKey = `type_boost_${candidate.entityType}` as ScoringFactorName;
  if (typeKey in weights) {
    score *= (weights as Record<string, number>)[typeKey] ?? 1.0;
  }

  if (candidate.lastModified) {
    const ageHours = (Date.now() - candidate.lastModified.getTime()) / 3_600_000;
    const decay = Math.exp(-0.005 * ageHours); // exponential decay over ~200 hours
    score += weights.recency_boost * decay;
  }

  if (candidate.relationshipDistance !== undefined) {
    score -= weights.relationship_distance_penalty * candidate.relationshipDistance;
  }

  return Math.max(0, score);
}

/**
 * Validates that a full set of scoring weights meets sanity constraints.
 * Prevents configurations that would invert result quality.
 *
 * @param weights - Proposed weights
 * @throws Error when validation fails (automatic rollback protection)
 */
export function validateWeights(weights: ScoringWeights): void {
  if (weights.bm25_weight < 0 || weights.embedding_weight < 0) {
    throw new Error('bm25_weight and embedding_weight must be non-negative');
  }
  const primarySum = weights.bm25_weight + weights.embedding_weight;
  if (primarySum < 0.5) {
    throw new Error('Sum of bm25_weight + embedding_weight must be ≥ 0.5 to avoid degenerate scoring');
  }
  if (weights.recency_boost < 0 || weights.recency_boost > 1) {
    throw new Error('recency_boost must be in [0, 1]');
  }
  if (weights.relationship_distance_penalty < 0 || weights.relationship_distance_penalty > 0.5) {
    throw new Error('relationship_distance_penalty must be in [0, 0.5]');
  }
}

/**
 * Manages per-workspace search relevance tuning.
 * Stores feedback signals and derived factor weights in Postgres.
 */
export class RelevanceTuner {
  private readonly sql: SqlClient;

  /**
   * @param sql - Postgres client
   */
  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  /**
   * Load the current scoring weights for a workspace.
   * Falls back to DEFAULT_WEIGHTS for any factor not yet tuned.
   *
   * @param workspaceId - Workspace to load weights for
   */
  async loadWeights(workspaceId: string): Promise<ScoringWeights> {
    const rows = await this.sql<Array<{ factor_name: ScoringFactorName; tuned_value: number }>>`
      SELECT factor_name, tuned_value
      FROM search_tuning_config
      WHERE workspace_id = ${workspaceId}
    `;

    const weights = { ...DEFAULT_WEIGHTS };
    for (const row of rows) {
      if (row.factor_name in weights) {
        (weights as Record<string, number>)[row.factor_name] = row.tuned_value;
      }
    }
    return weights;
  }

  /**
   * Persist a single factor weight update for a workspace.
   * Validates the full resulting weight set before committing.
   *
   * @param config - The factor and new value to persist
   */
  async updateWeight(config: TuningConfig): Promise<void> {
    const current = await this.loadWeights(config.workspaceId);
    const proposed = { ...current, [config.factorName]: config.tunedValue };
    validateWeights(proposed);

    await this.sql`
      INSERT INTO search_tuning_config (workspace_id, factor_name, tuned_value, updated_at)
      VALUES (${config.workspaceId}, ${config.factorName}, ${config.tunedValue}, now())
      ON CONFLICT (workspace_id, factor_name)
      DO UPDATE SET tuned_value = EXCLUDED.tuned_value, updated_at = now()
    `;

    log.info('Search weight updated', { workspaceId: config.workspaceId, factor: config.factorName, value: config.tunedValue });
  }

  /**
   * Record a click-through feedback signal for a search result.
   *
   * @param feedback - User interaction data
   */
  async recordFeedback(feedback: SearchFeedback): Promise<void> {
    await this.sql`
      INSERT INTO search_feedback
        (workspace_id, query, clicked_entity_id, rank, feedback_score, dwell_time_ms, timestamp)
      VALUES
        (${feedback.workspaceId}, ${feedback.query}, ${feedback.clickedEntityId},
         ${feedback.rank}, ${feedback.feedbackScore}, ${feedback.dwellTimeMs ?? null}, now())
    `;
    log.debug('Search feedback recorded', { workspaceId: feedback.workspaceId, rank: feedback.rank });
  }

  /**
   * Aggregate click-through data to derive recommended weight adjustments.
   * Queries with high CTR on position ≥5 suggest recency_boost or type_boost need adjustment.
   *
   * @param workspaceId - Workspace to analyze
   * @param windowDays  - Number of past days to include in analysis (default: 30)
   */
  async analyzeFeedback(workspaceId: string, windowDays = 30): Promise<Array<{ query: string; avgRank: number; clickCount: number; avgDwellMs: number | null }>> {
    const rows = await this.sql<Array<{ query: string; avg_rank: number; click_count: string; avg_dwell_ms: number | null }>>`
      SELECT
        query,
        AVG(rank)::float           AS avg_rank,
        COUNT(*)::text             AS click_count,
        AVG(dwell_time_ms)::float  AS avg_dwell_ms
      FROM search_feedback
      WHERE workspace_id = ${workspaceId}
        AND timestamp >= now() - (${windowDays} || ' days')::interval
      GROUP BY query
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `;

    return rows.map((r) => ({
      query: r.query,
      avgRank: r.avg_rank,
      clickCount: parseInt(r.click_count, 10),
      avgDwellMs: r.avg_dwell_ms,
    }));
  }

  /**
   * Reset all tuning config for a workspace back to defaults.
   *
   * @param workspaceId - Workspace to reset
   */
  async resetWeights(workspaceId: string): Promise<void> {
    await this.sql`DELETE FROM search_tuning_config WHERE workspace_id = ${workspaceId}`;
    log.info('Search weights reset to defaults', { workspaceId });
  }
}
