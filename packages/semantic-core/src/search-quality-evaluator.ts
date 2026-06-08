import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'search-quality-evaluator' });

type SqlClient = ReturnType<typeof postgres>;

export type RetrievalStrategy = 'vector' | 'bm25' | 'hybrid';

export interface TestSetQuery {
  query: string;
  expectedEntityIds: string[];
  /** Optional relevance scores 0–1 per entity for graded metrics */
  relevanceScores?: Record<string, number>;
}

export interface RetrievalMetrics {
  precisionAtK: number;
  recallAtK: number;
  ndcgAtK: number;
  mrr: number;
  sampleSize: number;
}

export interface StrategyComparison {
  control: { strategy: RetrievalStrategy; metrics: RetrievalMetrics };
  treatment: { strategy: RetrievalStrategy; metrics: RetrievalMetrics };
  winner: RetrievalStrategy | null;
  improvement: { metric: keyof RetrievalMetrics; delta: number } | null;
}

export interface SearchExperiment {
  id: string;
  workspaceId: string;
  name: string;
  controlStrategy: RetrievalStrategy;
  treatmentStrategy: RetrievalStrategy;
  testSetId: string | null;
  trafficPct: number;
  status: 'running' | 'paused' | 'promoted' | 'abandoned';
  winner: RetrievalStrategy | null;
  createdBy: string | null;
  createdAt: Date;
}

// ─── Pure metric computation functions ───────────────────────────────────────

/**
 * Compute precision at K — fraction of top-K results that are relevant.
 *
 * @param retrievedIds - Ordered list of retrieved entity IDs
 * @param expectedIds - Set of relevant entity IDs
 * @param k - Cutoff rank
 */
export function precisionAtK(retrievedIds: string[], expectedIds: string[], k: number): number {
  if (k <= 0 || retrievedIds.length === 0 || expectedIds.length === 0) return 0;
  const topK = retrievedIds.slice(0, k);
  const relevant = topK.filter((id) => expectedIds.includes(id)).length;
  return relevant / Math.min(k, topK.length);
}

/**
 * Compute recall at K — fraction of relevant entities found in top-K results.
 *
 * @param retrievedIds - Ordered list of retrieved entity IDs
 * @param expectedIds - Set of relevant entity IDs
 * @param k - Cutoff rank
 */
export function recallAtK(retrievedIds: string[], expectedIds: string[], k: number): number {
  if (k <= 0 || retrievedIds.length === 0 || expectedIds.length === 0) return 0;
  const topK = retrievedIds.slice(0, k);
  const relevant = topK.filter((id) => expectedIds.includes(id)).length;
  return relevant / expectedIds.length;
}

/**
 * Compute Normalized Discounted Cumulative Gain at K.
 * Uses binary relevance if no graded scores are provided.
 *
 * @param retrievedIds - Ordered list of retrieved entity IDs
 * @param expectedIds - Set of relevant entity IDs
 * @param k - Cutoff rank
 * @param relevanceScores - Optional per-entity graded relevance scores (0–1)
 */
export function ndcgAtK(
  retrievedIds: string[],
  expectedIds: string[],
  k: number,
  relevanceScores?: Record<string, number>,
): number {
  if (k <= 0 || retrievedIds.length === 0 || expectedIds.length === 0) return 0;

  const topK = retrievedIds.slice(0, k);

  // Actual DCG
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const id = topK[i]!;
    const rel = relevanceScores?.[id] ?? (expectedIds.includes(id) ? 1 : 0);
    dcg += rel / Math.log2(i + 2); // log2(rank + 1) where rank is 1-indexed
  }

  // Ideal DCG (all relevant docs at top ranks)
  const idealRels = expectedIds
    .map((id) => relevanceScores?.[id] ?? 1)
    .sort((a, b) => b - a)
    .slice(0, k);

  let idcg = 0;
  for (let i = 0; i < idealRels.length; i++) {
    idcg += idealRels[i]! / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Compute Mean Reciprocal Rank — average of reciprocal rank of first relevant result.
 *
 * @param retrievedIds - Ordered list of retrieved entity IDs
 * @param expectedIds - Set of relevant entity IDs
 */
export function meanReciprocalRank(retrievedIds: string[], expectedIds: string[]): number {
  if (retrievedIds.length === 0 || expectedIds.length === 0) return 0;
  const firstRelevantIdx = retrievedIds.findIndex((id) => expectedIds.includes(id));
  if (firstRelevantIdx === -1) return 0;
  return 1 / (firstRelevantIdx + 1);
}

/**
 * Compute all retrieval metrics for a single query result.
 *
 * @param retrievedIds - Ordered list of retrieved IDs
 * @param expectedIds - Set of relevant IDs
 * @param k - Cutoff rank (default: 5 for precision, 10 for recall)
 * @param relevanceScores - Optional graded relevance
 */
export function computeMetrics(
  retrievedIds: string[],
  expectedIds: string[],
  k = 5,
  relevanceScores?: Record<string, number>,
): RetrievalMetrics {
  return {
    precisionAtK: precisionAtK(retrievedIds, expectedIds, k),
    recallAtK: recallAtK(retrievedIds, expectedIds, k * 2),
    ndcgAtK: ndcgAtK(retrievedIds, expectedIds, k, relevanceScores),
    mrr: meanReciprocalRank(retrievedIds, expectedIds),
    sampleSize: 1,
  };
}

/**
 * Average multiple RetrievalMetrics objects into a single aggregate.
 *
 * @param metrics - Array of per-query metrics
 */
export function averageMetrics(metrics: RetrievalMetrics[]): RetrievalMetrics {
  if (metrics.length === 0) {
    return { precisionAtK: 0, recallAtK: 0, ndcgAtK: 0, mrr: 0, sampleSize: 0 };
  }
  const sum = metrics.reduce(
    (acc, m) => ({
      precisionAtK: acc.precisionAtK + m.precisionAtK,
      recallAtK: acc.recallAtK + m.recallAtK,
      ndcgAtK: acc.ndcgAtK + m.ndcgAtK,
      mrr: acc.mrr + m.mrr,
      sampleSize: acc.sampleSize + 1,
    }),
    { precisionAtK: 0, recallAtK: 0, ndcgAtK: 0, mrr: 0, sampleSize: 0 },
  );
  const n = metrics.length;
  return {
    precisionAtK: sum.precisionAtK / n,
    recallAtK: sum.recallAtK / n,
    ndcgAtK: sum.ndcgAtK / n,
    mrr: sum.mrr / n,
    sampleSize: n,
  };
}

/**
 * Compare two strategies and determine the winner by NDCG improvement.
 * Returns null winner if improvement is within noise threshold (< 0.01).
 *
 * @param control - Control strategy metrics
 * @param treatment - Treatment strategy metrics
 */
export function compareStrategies(
  control: { strategy: RetrievalStrategy; metrics: RetrievalMetrics },
  treatment: { strategy: RetrievalStrategy; metrics: RetrievalMetrics },
): StrategyComparison {
  const NOISE_THRESHOLD = 0.01;
  const ndcgDelta = treatment.metrics.ndcgAtK - control.metrics.ndcgAtK;
  const mrrDelta = treatment.metrics.mrr - control.metrics.mrr;

  let winner: RetrievalStrategy | null = null;
  let improvement: StrategyComparison['improvement'] = null;

  if (Math.abs(ndcgDelta) >= NOISE_THRESHOLD) {
    winner = ndcgDelta > 0 ? treatment.strategy : control.strategy;
    improvement = { metric: 'ndcgAtK', delta: ndcgDelta };
  } else if (Math.abs(mrrDelta) >= NOISE_THRESHOLD) {
    winner = mrrDelta > 0 ? treatment.strategy : control.strategy;
    improvement = { metric: 'mrr', delta: mrrDelta };
  }

  return { control, treatment, winner, improvement };
}

// ─── SearchQualityEvaluator service ──────────────────────────────────────────

/**
 * Manages search quality evaluation test sets and A/B experiments.
 */
export class SearchQualityEvaluator {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Create or update an evaluation test set.
   *
   * @param workspaceId - Target workspace
   * @param name - Test set name
   * @param queries - Array of query + expected entity ID pairs
   */
  async defineTestSet(
    workspaceId: string,
    name: string,
    queries: TestSetQuery[],
    description?: string,
  ): Promise<Result<{ id: string; workspaceId: string; name: string; queryCount: number }, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO search_quality_test_sets (workspace_id, name, description, queries)
        VALUES (${workspaceId}, ${name}, ${description ?? null}, ${JSON.stringify(queries)})
        ON CONFLICT (workspace_id, name) DO UPDATE
          SET queries = EXCLUDED.queries,
              description = COALESCE(EXCLUDED.description, search_quality_test_sets.description),
              updated_at = NOW()
        RETURNING id
      `;
      log.info('Test set defined', { workspaceId, name, queryCount: queries.length });
      return ok({ id: rows[0]!.id as string, workspaceId, name, queryCount: queries.length });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to define test set', { workspaceId, name, error: error.message });
      return err(error);
    }
  }

  /**
   * Create a new A/B search experiment.
   *
   * @param workspaceId - Target workspace
   * @param name - Experiment name
   * @param controlStrategy - Control retrieval strategy
   * @param treatmentStrategy - Treatment retrieval strategy to test
   * @param testSetId - Optional test set to measure against
   * @param trafficPct - Percentage of traffic routed to treatment (default: 10)
   */
  async createExperiment(
    workspaceId: string,
    name: string,
    controlStrategy: RetrievalStrategy,
    treatmentStrategy: RetrievalStrategy,
    testSetId?: string,
    trafficPct = 10,
  ): Promise<Result<SearchExperiment, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO search_experiments
          (workspace_id, name, control_strategy, treatment_strategy, test_set_id, traffic_pct)
        VALUES
          (${workspaceId}, ${name}, ${controlStrategy}, ${treatmentStrategy}, ${testSetId ?? null}, ${trafficPct})
        RETURNING *
      `;
      log.info('Search experiment created', { workspaceId, name, controlStrategy, treatmentStrategy });
      return ok(mapExperimentRow(rows[0]));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to create experiment', { workspaceId, name, error: error.message });
      return err(error);
    }
  }

  /**
   * Record metric results for an experiment strategy.
   *
   * @param experimentId - Target experiment
   * @param strategyName - Strategy name ('control' or 'treatment')
   * @param metrics - Measured retrieval metrics
   */
  async recordResult(
    experimentId: string,
    strategyName: string,
    metrics: RetrievalMetrics,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO search_experiment_results
          (experiment_id, strategy_name, precision_at_5, recall_at_10, ndcg, mrr, sample_size)
        VALUES
          (${experimentId}, ${strategyName}, ${metrics.precisionAtK}, ${metrics.recallAtK},
           ${metrics.ndcgAtK}, ${metrics.mrr}, ${metrics.sampleSize})
      `;
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to record experiment result', { experimentId, error: error.message });
      return err(error);
    }
  }

  /**
   * Get aggregated results for all strategies in an experiment.
   *
   * @param experimentId - Target experiment
   */
  async getResults(
    experimentId: string,
  ): Promise<Result<Array<{ strategyName: string; metrics: RetrievalMetrics }>, Error>> {
    try {
      const rows = await this.sql`
        SELECT
          strategy_name,
          AVG(precision_at_5)::FLOAT AS precision_at_k,
          AVG(recall_at_10)::FLOAT   AS recall_at_k,
          AVG(ndcg)::FLOAT           AS ndcg_at_k,
          AVG(mrr)::FLOAT            AS mrr,
          SUM(sample_size)::INTEGER  AS sample_size
        FROM search_experiment_results
        WHERE experiment_id = ${experimentId}
        GROUP BY strategy_name
      `;
      return ok(rows.map((r) => ({
        strategyName: r.strategy_name as string,
        metrics: {
          precisionAtK: Number(r.precision_at_k),
          recallAtK: Number(r.recall_at_k),
          ndcgAtK: Number(r.ndcg_at_k),
          mrr: Number(r.mrr),
          sampleSize: Number(r.sample_size),
        },
      })));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to get experiment results', { experimentId, error: error.message });
      return err(error);
    }
  }

  /**
   * Promote the winning strategy for an experiment and close it.
   * Sets status=promoted and winner=treatmentStrategy if treatment won.
   *
   * @param workspaceId - Target workspace
   * @param experimentId - Experiment to promote
   * @param winner - The winning strategy to promote
   */
  async promoteExperiment(
    workspaceId: string,
    experimentId: string,
    winner: RetrievalStrategy,
  ): Promise<Result<SearchExperiment, Error>> {
    try {
      const rows = await this.sql`
        UPDATE search_experiments
        SET status = 'promoted', winner = ${winner}, traffic_pct = 100, updated_at = NOW()
        WHERE id = ${experimentId} AND workspace_id = ${workspaceId} AND status = 'running'
        RETURNING *
      `;
      if (rows.length === 0) {
        return err(new Error(`Experiment ${experimentId} not found or not in running state`));
      }
      log.info('Experiment promoted', { workspaceId, experimentId, winner });
      return ok(mapExperimentRow(rows[0]));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to promote experiment', { experimentId, error: error.message });
      return err(error);
    }
  }

  /**
   * List all experiments for a workspace.
   *
   * @param workspaceId - Target workspace
   * @param status - Optional status filter
   */
  async listExperiments(
    workspaceId: string,
    status?: SearchExperiment['status'],
  ): Promise<Result<SearchExperiment[], Error>> {
    try {
      const rows = status
        ? await this.sql`
            SELECT * FROM search_experiments
            WHERE workspace_id = ${workspaceId} AND status = ${status}
            ORDER BY created_at DESC
          `
        : await this.sql`
            SELECT * FROM search_experiments
            WHERE workspace_id = ${workspaceId}
            ORDER BY created_at DESC
          `;
      return ok(rows.map(mapExperimentRow));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to list experiments', { workspaceId, error: error.message });
      return err(error);
    }
  }
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

interface ExperimentRow {
  id: string;
  workspace_id: string;
  name: string;
  control_strategy: string;
  treatment_strategy: string;
  test_set_id: string | null;
  traffic_pct: number;
  status: string;
  winner: string | null;
  created_by: string | null;
  created_at: Date;
}

function mapExperimentRow(r: unknown): SearchExperiment {
  const row = r as ExperimentRow;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    controlStrategy: row.control_strategy as RetrievalStrategy,
    treatmentStrategy: row.treatment_strategy as RetrievalStrategy,
    testSetId: row.test_set_id,
    trafficPct: row.traffic_pct,
    status: row.status as SearchExperiment['status'],
    winner: row.winner as RetrievalStrategy | null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
