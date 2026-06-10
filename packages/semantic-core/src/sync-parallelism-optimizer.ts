import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

export type HistoricalMetrics = {
  concurrency: number;
  throughputPerSec: number;
  p95LatencyMs: number;
  errorRate: number;
  entityCount: number;
  durationMs: number;
};

export type OptimizationConfig = {
  connectorId: string;
  workspaceId: string;
  entityType: string;
  concurrency: number;
  batchSize: number;
  workerWeight: number;
  autoTune: boolean;
  lastTunedAt: Date | null;
};

export type WorkerAllocation = {
  connectorId: string;
  workers: number;
  weight: number;
};

export type OptimizationWindow = {
  connectorId: string;
  stableEnough: boolean;
  reason: string;
  lastRateLimitAt: Date | null;
  recentErrorRate: number;
  windowStart: Date;
};

export type ExperimentVariant = {
  name: string;
  concurrency: number;
  batchSize: number;
  trafficPct: number;
};

export type ExperimentResult = {
  experimentId: string;
  variantName: string;
  throughputPerSec: number;
  p95LatencyMs: number;
  errorRate: number;
  entitiesSynced: number;
  durationMs: number;
};

export type TuningRecommendation = {
  connectorId: string;
  workspaceId: string;
  entityType: string;
  currentConcurrency: number;
  recommendedConcurrency: number;
  currentBatchSize: number;
  recommendedBatchSize: number;
  reasoning: string;
  confidenceScore: number;
};

const LATENCY_THRESHOLD_MS = 5000;
const MAX_CONCURRENCY = 20;
const MIN_CONCURRENCY = 1;
const MAX_BATCH_SIZE = 1000;
const MIN_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_BATCH_SIZE = 100;
const STABLE_ERROR_RATE_THRESHOLD = 0.05;
const HILL_CLIMB_STEP = 2;

/**
 * Adaptive sync optimizer that tunes concurrency, batch sizes, and worker pool
 * allocation based on observed performance metrics.
 */
export class SyncParallelismOptimizer {
  constructor(private readonly sql: Sql) {}

  /**
   * Recommends optimal concurrency for a connector using hill-climbing search.
   * Maximizes throughput/s while keeping p95 latency below threshold.
   *
   * @param connectorId - Connector to analyze
   * @param entityType - Entity type to optimize for
   * @param historicalMetrics - Past sync metrics at different concurrency levels
   * @returns Recommended concurrency and reasoning
   */
  async recommendConcurrency(
    connectorId: string,
    entityType: string,
    historicalMetrics: HistoricalMetrics[]
  ): Promise<{ recommended: number; reasoning: string; confidenceScore: number }> {
    if (historicalMetrics.length === 0) {
      return {
        recommended: DEFAULT_CONCURRENCY,
        reasoning: 'No historical data — using safe default',
        confidenceScore: 0.3,
      };
    }

    const validMetrics = historicalMetrics.filter(
      (m) => m.p95LatencyMs <= LATENCY_THRESHOLD_MS && m.errorRate < STABLE_ERROR_RATE_THRESHOLD
    );

    if (validMetrics.length === 0) {
      const safest = historicalMetrics.reduce((a, b) =>
        a.errorRate < b.errorRate ? a : b
      );
      const recommended = Math.max(MIN_CONCURRENCY, Math.floor(safest.concurrency / 2));
      return {
        recommended,
        reasoning: `All observed concurrency levels exceeded thresholds — backing off to ${recommended}`,
        confidenceScore: 0.5,
      };
    }

    const best = validMetrics.reduce((a, b) =>
      a.throughputPerSec > b.throughputPerSec ? a : b
    );

    const candidate = hillClimb(validMetrics, best.concurrency);
    const recommended = Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, candidate));

    logger.debug('recommendConcurrency result', {
      connectorId,
      entityType,
      recommended,
      bestObserved: best.concurrency,
      throughput: best.throughputPerSec,
    });

    return {
      recommended,
      reasoning: `Hill-climbing from observed best (${best.concurrency}) → ${recommended}. Throughput ${best.throughputPerSec.toFixed(2)}/s at p95=${best.p95LatencyMs}ms`,
      confidenceScore: Math.min(0.95, 0.4 + validMetrics.length * 0.1),
    };
  }

  /**
   * Adapts batch size based on error rate and throughput to find the sweet spot.
   *
   * @param connectorId - Connector to tune
   * @param currentBatch - Current batch size
   * @param recentErrorRate - Error rate in latest sync window (0-1)
   * @param avgPayloadBytes - Average payload size per entity
   * @returns Recommended batch size
   */
  tuneRequestBatchSize(
    connectorId: string,
    currentBatch: number,
    recentErrorRate: number,
    avgPayloadBytes: number
  ): { recommendedBatch: number; reason: string } {
    const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB per batch

    if (recentErrorRate > 0.2) {
      const reduced = Math.max(MIN_BATCH_SIZE, Math.floor(currentBatch * 0.5));
      return { recommendedBatch: reduced, reason: `High error rate ${(recentErrorRate * 100).toFixed(1)}% — halving batch size` };
    }

    if (recentErrorRate > 0.05) {
      const reduced = Math.max(MIN_BATCH_SIZE, Math.floor(currentBatch * 0.8));
      return { recommendedBatch: reduced, reason: `Elevated error rate ${(recentErrorRate * 100).toFixed(1)}% — reducing batch by 20%` };
    }

    const maxByPayload = avgPayloadBytes > 0
      ? Math.floor(MAX_PAYLOAD_BYTES / avgPayloadBytes)
      : MAX_BATCH_SIZE;
    const payloadCap = Math.max(MIN_BATCH_SIZE, Math.min(maxByPayload, MAX_BATCH_SIZE));

    if (currentBatch > payloadCap) {
      return { recommendedBatch: payloadCap, reason: `Batch exceeds payload budget (${avgPayloadBytes}B/entity) — capping at ${payloadCap}` };
    }

    if (recentErrorRate < 0.01) {
      const increased = Math.min(payloadCap, Math.floor(currentBatch * 1.25));
      if (increased > currentBatch) {
        return { recommendedBatch: increased, reason: `Low error rate — growing batch to ${increased} (payload cap: ${payloadCap})` };
      }
    }

    return { recommendedBatch: currentBatch, reason: 'Batch size is in optimal range' };
  }

  /**
   * Distributes available BullMQ workers across connectors using weighted allocation.
   * High entity-count connectors get more workers; recently-degraded get less.
   *
   * @param workspaceId - Workspace to allocate for
   * @param connectorIds - Connectors competing for workers
   * @param totalWorkers - Available worker budget
   * @returns Per-connector worker allocation
   */
  async allocateWorkerPool(
    workspaceId: string,
    connectorIds: string[],
    totalWorkers: number
  ): Promise<WorkerAllocation[]> {
    if (connectorIds.length === 0) return [];

    const rows = await this.sql<
      Array<{ connectorId: string; workerWeight: number }>
    >`
      SELECT
        connector_id          AS "connectorId",
        worker_weight::FLOAT  AS "workerWeight"
      FROM sync_optimization_configs
      WHERE workspace_id = ${workspaceId}
        AND connector_id = ANY(${connectorIds})
    `;

    const weightMap = new Map(rows.map((r) => [r.connectorId, r.workerWeight]));

    const weights = connectorIds.map((id) => ({
      connectorId: id,
      weight: weightMap.get(id) ?? 1.0,
    }));

    const totalWeight = weights.reduce((s, w) => s + w.weight, 0);

    return weights.map(({ connectorId, weight }) => ({
      connectorId,
      workers: Math.max(1, Math.round((weight / totalWeight) * totalWorkers)),
      weight,
    }));
  }

  /**
   * Identifies stable periods suitable for tuning experiments.
   * A window is stable if no rate-limits in last 24h and error rate < 5%.
   *
   * @param connectorId - Connector to inspect
   * @param workspaceId - Workspace context
   * @returns Whether a tuning experiment is safe to run
   */
  async detectOptimizationWindow(
    connectorId: string,
    workspaceId: string
  ): Promise<OptimizationWindow> {
    const rows = await this.sql<
      Array<{ recentErrorRate: number; lastRateLimitAt: Date | null }>
    >`
      SELECT
        COALESCE(
          -- "average error rate of the 5 most recent scores": ORDER BY/LIMIT
          -- must wrap in a subquery — they are invalid alongside a bare
          -- aggregate (42803). Aliases are quoted because Postgres lowercases
          -- unquoted identifiers and this client does no case transform.
          (SELECT AVG(1 - success_rate) FROM (
             SELECT success_rate FROM reliability_scores
             WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
             ORDER BY computed_at DESC LIMIT 5
           ) recent),
          0
        ) AS "recentErrorRate",
        (SELECT MAX(created_at) FROM reliability_alerts
         WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
           AND alert_type = 'warning'
           AND created_at > NOW() - INTERVAL '24 hours'
        ) AS "lastRateLimitAt"
    `;

    const row = rows[0] ?? { recentErrorRate: 0, lastRateLimitAt: null };
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const hadRecentAlert = row.lastRateLimitAt !== null;
    const highErrors = row.recentErrorRate > STABLE_ERROR_RATE_THRESHOLD;

    let stableEnough = true;
    let reason = 'Conditions are stable — experiment safe to run';

    if (hadRecentAlert) {
      stableEnough = false;
      reason = `Rate-limit alert within 24h (${row.lastRateLimitAt?.toISOString()}) — defer experiment`;
    } else if (highErrors) {
      stableEnough = false;
      reason = `Elevated error rate ${(row.recentErrorRate * 100).toFixed(1)}% — stabilize before tuning`;
    }

    return {
      connectorId,
      stableEnough,
      reason,
      lastRateLimitAt: row.lastRateLimitAt,
      recentErrorRate: row.recentErrorRate,
      windowStart,
    };
  }

  /**
   * A/B tests a concurrency variant on a percentage of the next sync run,
   * measuring throughput impact.
   *
   * @param connectorId - Connector to experiment on
   * @param workspaceId - Workspace context
   * @param variant - Experiment parameters
   * @returns Experiment ID for later retrieval
   */
  async executeOptimizationExperiment(
    connectorId: string,
    workspaceId: string,
    variant: ExperimentVariant
  ): Promise<string> {
    const rows = await this.sql<Array<{ id: string }>>`
      INSERT INTO optimization_experiments
        (connector_id, workspace_id, variant_name, concurrency, batch_size, traffic_pct, status, started_at)
      VALUES
        (${connectorId}, ${workspaceId}, ${variant.name}, ${variant.concurrency},
         ${variant.batchSize}, ${variant.trafficPct}, 'running', NOW())
      RETURNING id
    `;

    const expId = rows[0]?.id;
    if (!expId) throw new Error('Failed to create optimization experiment');

    logger.info('Optimization experiment started', {
      experimentId: expId,
      connectorId,
      workspaceId,
      variant,
    });

    return expId;
  }

  /**
   * Records results for a running experiment and marks it completed.
   *
   * @param experimentId - Experiment to record results for
   * @param results - Observed throughput and latency metrics
   */
  async recordExperimentResults(
    experimentId: string,
    connectorId: string,
    workspaceId: string,
    results: Omit<ExperimentResult, 'experimentId' | 'variantName'>
  ): Promise<void> {
    await this.sql`
      INSERT INTO experiment_results
        (experiment_id, connector_id, workspace_id, throughput_per_sec, p95_latency_ms,
         error_rate, entities_synced, duration_ms)
      VALUES
        (${experimentId}, ${connectorId}, ${workspaceId}, ${results.throughputPerSec},
         ${results.p95LatencyMs}, ${results.errorRate}, ${results.entitiesSynced}, ${results.durationMs})
    `;

    await this.sql`
      UPDATE optimization_experiments
      SET status = 'completed', completed_at = NOW()
      WHERE id = ${experimentId}
    `;
  }

  /**
   * Retrieves the current optimization config for a connector plus a full recommendation.
   *
   * @param connectorId - Connector to fetch config for
   * @param workspaceId - Workspace context
   * @param historicalMetrics - Recent sync metrics for recommendation computation
   */
  async getConfigWithRecommendation(
    connectorId: string,
    workspaceId: string,
    historicalMetrics: HistoricalMetrics[]
  ): Promise<{ current: OptimizationConfig; recommendation: TuningRecommendation }> {
    const rows = await this.sql<OptimizationConfig[]>`
      SELECT connector_id, workspace_id, entity_type, concurrency, batch_size,
             worker_weight, auto_tune, last_tuned_at
      FROM sync_optimization_configs
      WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
      LIMIT 1
    `;

    const current: OptimizationConfig = rows[0] ?? {
      connectorId,
      workspaceId,
      entityType: '*',
      concurrency: DEFAULT_CONCURRENCY,
      batchSize: DEFAULT_BATCH_SIZE,
      workerWeight: 1.0,
      autoTune: true,
      lastTunedAt: null,
    };

    const rec = await this.recommendConcurrency(connectorId, current.entityType, historicalMetrics);
    const lastMetric = historicalMetrics[historicalMetrics.length - 1];
    const batchRec = lastMetric
      ? this.tuneRequestBatchSize(
          connectorId,
          current.batchSize,
          lastMetric.errorRate,
          0
        )
      : { recommendedBatch: current.batchSize, reason: 'No recent metrics' };

    const recommendation: TuningRecommendation = {
      connectorId,
      workspaceId,
      entityType: current.entityType,
      currentConcurrency: current.concurrency,
      recommendedConcurrency: rec.recommended,
      currentBatchSize: current.batchSize,
      recommendedBatchSize: batchRec.recommendedBatch,
      reasoning: `${rec.reasoning}; ${batchRec.reason}`,
      confidenceScore: rec.confidenceScore,
    };

    return { current, recommendation };
  }

  /**
   * Persists (upserts) an optimization config for a connector.
   *
   * @param config - Configuration to save
   */
  async saveConfig(config: OptimizationConfig): Promise<void> {
    await this.sql`
      INSERT INTO sync_optimization_configs
        (connector_id, workspace_id, entity_type, concurrency, batch_size, worker_weight, auto_tune, last_tuned_at)
      VALUES
        (${config.connectorId}, ${config.workspaceId}, ${config.entityType},
         ${config.concurrency}, ${config.batchSize}, ${config.workerWeight},
         ${config.autoTune}, ${config.lastTunedAt ?? null})
      ON CONFLICT (connector_id, workspace_id, entity_type)
      DO UPDATE SET
        concurrency   = EXCLUDED.concurrency,
        batch_size    = EXCLUDED.batch_size,
        worker_weight = EXCLUDED.worker_weight,
        auto_tune     = EXCLUDED.auto_tune,
        last_tuned_at = EXCLUDED.last_tuned_at,
        updated_at    = NOW()
    `;
  }

  /**
   * Lists completed experiments for a connector, ordered by most recent.
   *
   * @param connectorId - Connector to list experiments for
   * @param workspaceId - Workspace context
   * @param limit - Max results
   */
  async listExperiments(
    connectorId: string,
    workspaceId: string,
    limit = 20
  ): Promise<Array<{ experiment: Record<string, unknown>; result: Record<string, unknown> | null }>> {
    const rows = await this.sql<
      Array<{
        expId: string;
        variantName: string;
        concurrency: number;
        batchSize: number;
        trafficPct: number;
        status: string;
        startedAt: Date | null;
        completedAt: Date | null;
        throughputPerSec: number | null;
        p95LatencyMs: number | null;
        errorRate: number | null;
        entitiesSynced: number | null;
      }>
    >`
      SELECT
        e.id            AS exp_id,
        e.variant_name,
        e.concurrency,
        e.batch_size,
        e.traffic_pct,
        e.status,
        e.started_at,
        e.completed_at,
        r.throughput_per_sec,
        r.p95_latency_ms,
        r.error_rate,
        r.entities_synced
      FROM optimization_experiments e
      LEFT JOIN experiment_results r ON r.experiment_id = e.id
      WHERE e.connector_id   = ${connectorId}
        AND e.workspace_id   = ${workspaceId}
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      experiment: {
        id: r.expId,
        variantName: r.variantName,
        concurrency: r.concurrency,
        batchSize: r.batchSize,
        trafficPct: r.trafficPct,
        status: r.status,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      },
      result: r.throughputPerSec !== null
        ? {
            throughputPerSec: r.throughputPerSec,
            p95LatencyMs: r.p95LatencyMs,
            errorRate: r.errorRate,
            entitiesSynced: r.entitiesSynced,
          }
        : null,
    }));
  }
}

function hillClimb(metrics: HistoricalMetrics[], currentBest: number): number {
  const lookup = new Map(metrics.map((m) => [m.concurrency, m]));

  const candidateUp = currentBest + HILL_CLIMB_STEP;
  const candidateDown = currentBest - HILL_CLIMB_STEP;

  const scoreAt = (c: number): number => {
    const m = lookup.get(c);
    if (!m) return -1;
    if (m.p95LatencyMs > LATENCY_THRESHOLD_MS) return -1;
    return m.throughputPerSec;
  };

  const scoreUp = scoreAt(candidateUp);
  const scoreCurrent = scoreAt(currentBest);
  const scoreDown = scoreAt(candidateDown);

  if (scoreUp > scoreCurrent && scoreUp > scoreDown) return candidateUp;
  if (scoreDown > scoreCurrent) return Math.max(MIN_CONCURRENCY, candidateDown);
  return currentBest;
}
