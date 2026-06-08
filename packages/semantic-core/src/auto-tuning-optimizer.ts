import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ service: 'auto-tuning-optimizer' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecommendationType =
  | 'split_entity_type'
  | 'merge_entity_types'
  | 'boost_freshness'
  | 'disable_embedding'
  | 'enable_full_text'
  | 'increase_batch_size';

export type RecommendationStatus = 'pending' | 'testing' | 'applied' | 'rolled_back' | 'dismissed';

export interface TuningRecommendation {
  id: string;
  workspaceId: string;
  type: RecommendationType;
  title: string;
  description: string;
  estimatedMonthlySavingsCents: number;
  estimatedQualityImpactPct: number;
  status: RecommendationStatus;
  abTestId: string | null;
  createdAt: string;
}

export interface QueryPatternAnalysis {
  topQueries: Array<{ query: string; count: number }>;
  zeroResultQueries: Array<{ query: string; count: number }>;
  unusedEntityTypes: string[];
  highFrequencyEntityTypes: string[];
  avgQueryLatencyMs: number;
}

export interface AbTestResult {
  testId: string;
  recommendationId: string;
  status: 'running' | 'concluded';
  controlMetric: number;
  treatmentMetric: number;
  improvementPct: number;
  conclusionAt: string | null;
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface QueryLogRow {
  query_text: string;
  result_count: string;
  latency_ms: string;
  count: string;
}

interface EntityTypeUsageRow {
  entity_type: string;
  query_count: string;
  last_used: string | null;
}

interface RecommendationRow {
  id: string;
  workspace_id: string;
  type: RecommendationType;
  title: string;
  description: string;
  estimated_monthly_savings_cents: string;
  estimated_quality_impact_pct: string;
  status: RecommendationStatus;
  ab_test_id: string | null;
  created_at: string;
}

interface AbTestRow {
  id: string;
  recommendation_id: string;
  status: 'running' | 'concluded';
  control_metric: string;
  treatment_metric: string;
  conclusion_at: string | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Analyses query logs and index state to generate index tuning recommendations,
 * runs A/B tests, and learns from feedback.
 */
export class AutoTuningOptimizer {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Analyses query patterns for a workspace over the last N days.
   *
   * @param workspaceId - Target workspace
   * @param days - Look-back window in days (default: 30)
   * @returns QueryPatternAnalysis
   */
  async analyzeQueryPatterns(workspaceId: string, days = 30): Promise<Result<QueryPatternAnalysis, Error>> {
    try {
      const [topRows, zeroRows, entityRows, latencyRow] = await Promise.all([
        this.sql`
          SELECT query_text, COUNT(*)::TEXT AS count
          FROM mcp_query_audit
          WHERE workspace_id = ${workspaceId}
            AND created_at > NOW() - ${days + ' days'}::INTERVAL
          GROUP BY query_text
          ORDER BY count::BIGINT DESC
          LIMIT 20
        ` as Promise<QueryLogRow[]>,
        this.sql`
          SELECT query_text, COUNT(*)::TEXT AS count
          FROM mcp_query_audit
          WHERE workspace_id = ${workspaceId}
            AND result_count = 0
            AND created_at > NOW() - ${days + ' days'}::INTERVAL
          GROUP BY query_text
          ORDER BY count::BIGINT DESC
          LIMIT 10
        ` as Promise<QueryLogRow[]>,
        this.sql`
          SELECT entity_type,
                 COUNT(DISTINCT q.id)::TEXT AS query_count,
                 MAX(q.created_at)::TEXT AS last_used
          FROM mcp_query_audit q
          JOIN LATERAL unnest(q.entity_types_returned) AS entity_type ON TRUE
          WHERE q.workspace_id = ${workspaceId}
            AND q.created_at > NOW() - ${days + ' days'}::INTERVAL
          GROUP BY entity_type
          ORDER BY query_count::BIGINT DESC
        ` as Promise<EntityTypeUsageRow[]>,
        this.sql`
          SELECT ROUND(AVG(latency_ms))::TEXT AS avg_ms
          FROM mcp_query_audit
          WHERE workspace_id = ${workspaceId}
            AND created_at > NOW() - ${days + ' days'}::INTERVAL
        ` as Promise<Array<{ avg_ms: string }>>,
      ]);

      const usedTypes = new Set(entityRows.map((r) => r.entity_type));
      const allEntityTypes = await this.sql`
        SELECT DISTINCT entity_type FROM indexed_entities WHERE workspace_id = ${workspaceId}
      ` as Array<{ entity_type: string }>;
      const unusedEntityTypes = allEntityTypes
        .map((r) => r.entity_type)
        .filter((t) => !usedTypes.has(t));
      const highFrequencyEntityTypes = entityRows
        .filter((r) => parseInt(r.query_count, 10) > 10)
        .map((r) => r.entity_type);

      log.info('Query pattern analysis complete', { workspaceId, days });
      return ok({
        topQueries: topRows.map((r) => ({ query: r.query_text, count: parseInt(r.count, 10) })),
        zeroResultQueries: zeroRows.map((r) => ({ query: r.query_text, count: parseInt(r.count, 10) })),
        unusedEntityTypes,
        highFrequencyEntityTypes,
        avgQueryLatencyMs: parseFloat(latencyRow[0]?.avg_ms ?? '0'),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generates tuning recommendations based on current index state and query patterns.
   *
   * @param workspaceId - Target workspace
   * @returns list of new TuningRecommendation rows inserted into the DB
   */
  async generateRecommendations(workspaceId: string): Promise<Result<TuningRecommendation[], Error>> {
    try {
      const patternResult = await this.analyzeQueryPatterns(workspaceId);
      if (patternResult.isErr()) return err(patternResult.error);
      const patterns = patternResult.value;

      const recs: Array<Omit<TuningRecommendation, 'id' | 'createdAt' | 'abTestId'>> = [];

      if (patterns.zeroResultQueries.length > 3) {
        recs.push({
          workspaceId,
          type: 'enable_full_text',
          title: `${patterns.zeroResultQueries.length} query types return no results`,
          description: `Enable full-text BM25 fallback search to reduce zero-result rate. Current zero-result queries: "${patterns.zeroResultQueries.slice(0, 3).map((q) => q.query).join('", "')}".`,
          estimatedMonthlySavingsCents: 0,
          estimatedQualityImpactPct: 15,
          status: 'pending',
        });
      }

      for (const entityType of patterns.unusedEntityTypes) {
        recs.push({
          workspaceId,
          type: 'disable_embedding',
          title: `Entity type "${entityType}" is never returned in queries`,
          description: `Disable embedding indexing for "${entityType}" to reduce embedding API cost. No queries have referenced this type in the last 30 days.`,
          estimatedMonthlySavingsCents: 500,
          estimatedQualityImpactPct: 0,
          status: 'pending',
        });
      }

      if (patterns.avgQueryLatencyMs > 500) {
        recs.push({
          workspaceId,
          type: 'increase_batch_size',
          title: 'Query latency is above 500ms threshold',
          description: `Average query latency is ${patterns.avgQueryLatencyMs.toFixed(0)}ms. Increasing embedding batch size and enabling index caching can reduce latency by ~30%.`,
          estimatedMonthlySavingsCents: 0,
          estimatedQualityImpactPct: 5,
          status: 'pending',
        });
      }

      if (recs.length === 0) {
        log.info('No recommendations needed', { workspaceId });
        return ok([]);
      }

      const inserted = await this.sql`
        INSERT INTO auto_tuning_recommendations
          (workspace_id, type, title, description, estimated_monthly_savings_cents,
           estimated_quality_impact_pct, status)
        SELECT * FROM unnest(
          ${recs.map((r) => r.workspaceId)}::TEXT[],
          ${recs.map((r) => r.type)}::TEXT[],
          ${recs.map((r) => r.title)}::TEXT[],
          ${recs.map((r) => r.description)}::TEXT[],
          ${recs.map((r) => r.estimatedMonthlySavingsCents)}::INTEGER[],
          ${recs.map((r) => r.estimatedQualityImpactPct)}::NUMERIC[],
          ${recs.map((r) => r.status)}::TEXT[]
        ) AS t(workspace_id, type, title, description, estimated_monthly_savings_cents, estimated_quality_impact_pct, status)
        RETURNING *
      ` as RecommendationRow[];

      log.info('Recommendations generated', { workspaceId, count: inserted.length });
      return ok(inserted.map(rowToRec));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists pending recommendations for a workspace.
   *
   * @param workspaceId - Target workspace
   * @returns list of TuningRecommendation
   */
  async listRecommendations(workspaceId: string): Promise<Result<TuningRecommendation[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM auto_tuning_recommendations
        WHERE workspace_id = ${workspaceId}
          AND status NOT IN ('dismissed', 'rolled_back')
        ORDER BY created_at DESC
        LIMIT 50
      ` as RecommendationRow[];
      return ok(rows.map(rowToRec));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Activates an A/B test for a recommendation (routes 10% of traffic).
   *
   * @param workspaceId - Target workspace
   * @param recommendationId - The recommendation to test
   * @returns AbTestResult with the new test record
   */
  async activateAbTest(workspaceId: string, recommendationId: string): Promise<Result<AbTestResult, Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM auto_tuning_recommendations
        WHERE id = ${recommendationId}
          AND workspace_id = ${workspaceId}
          AND status = 'pending'
        LIMIT 1
      ` as RecommendationRow[];

      if (rows.length === 0) {
        return err(new Error('Recommendation not found or not in pending state'));
      }

      const [testRow] = await this.sql`
        INSERT INTO auto_tuning_ab_tests (recommendation_id, status, control_metric, treatment_metric)
        VALUES (${recommendationId}, 'running', 0, 0)
        RETURNING *
      ` as AbTestRow[];

      if (!testRow) return err(new Error('Failed to create A/B test'));

      await this.sql`
        UPDATE auto_tuning_recommendations
        SET status = 'testing', ab_test_id = ${testRow.id}
        WHERE id = ${recommendationId}
      `;

      log.info('A/B test activated', { workspaceId, recommendationId, testId: testRow.id });
      return ok(rowToTest(testRow));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Records user feedback on a recommendation (helpful / not helpful).
   *
   * @param workspaceId - Target workspace
   * @param recommendationId - Recommendation being rated
   * @param helpful - true = helpful, false = not helpful (dismisses it)
   */
  async recordFeedback(workspaceId: string, recommendationId: string, helpful: boolean): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE auto_tuning_recommendations
        SET status = ${helpful ? 'applied' : 'dismissed'},
            feedback_helpful = ${helpful}
        WHERE id = ${recommendationId}
          AND workspace_id = ${workspaceId}
      `;
      log.info('Feedback recorded', { workspaceId, recommendationId, helpful });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Concludes an A/B test: rolls back if metrics degraded, applies if improved.
   *
   * @param testId - The A/B test to conclude
   * @param controlMetric - Baseline quality metric (e.g., avg relevance score)
   * @param treatmentMetric - Test-group quality metric
   */
  async concludeAbTest(testId: string, controlMetric: number, treatmentMetric: number): Promise<Result<AbTestResult, Error>> {
    try {
      const improvementPct = controlMetric > 0
        ? parseFloat((((treatmentMetric - controlMetric) / controlMetric) * 100).toFixed(2))
        : 0;

      const [updated] = await this.sql`
        UPDATE auto_tuning_ab_tests
        SET status = 'concluded',
            control_metric = ${controlMetric},
            treatment_metric = ${treatmentMetric},
            conclusion_at = NOW()
        WHERE id = ${testId}
        RETURNING *
      ` as AbTestRow[];

      if (!updated) return err(new Error('A/B test not found'));

      const newStatus: RecommendationStatus = improvementPct >= 0 ? 'applied' : 'rolled_back';
      await this.sql`
        UPDATE auto_tuning_recommendations
        SET status = ${newStatus}
        WHERE ab_test_id = ${testId}
      `;

      log.info('A/B test concluded', { testId, improvementPct, outcome: newStatus });
      return ok({ ...rowToTest(updated), improvementPct });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToRec(r: RecommendationRow): TuningRecommendation {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    type: r.type,
    title: r.title,
    description: r.description,
    estimatedMonthlySavingsCents: parseInt(r.estimated_monthly_savings_cents, 10),
    estimatedQualityImpactPct: parseFloat(r.estimated_quality_impact_pct),
    status: r.status,
    abTestId: r.ab_test_id,
    createdAt: r.created_at,
  };
}

function rowToTest(r: AbTestRow): AbTestResult {
  return {
    testId: r.id,
    recommendationId: r.recommendation_id,
    status: r.status,
    controlMetric: parseFloat(r.control_metric),
    treatmentMetric: parseFloat(r.treatment_metric),
    improvementPct: 0,
    conclusionAt: r.conclusion_at,
  };
}
