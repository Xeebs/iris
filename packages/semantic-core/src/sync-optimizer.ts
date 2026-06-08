import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'sync-optimizer' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncMetricRow = {
  metric_id: string;
  connector_id: string;
  sync_id: string;
  workspace_id: string;
  batch_size: number;
  entity_count: number;
  token_count: number;
  duration_ms: number;
  entity_throughput: number;
  token_throughput: number;
  api_calls: number;
  rate_limited: boolean;
  error_count: number;
  recorded_at: string;
};

export type SyncLatencyStats = {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgEntityThroughput: number;
  avgTokenThroughput: number;
  totalSyncs: number;
  failureRate: number;
};

export type BatchSizeRecommendation = {
  connectorId: string;
  recommendedBatchSize: number;
  currentAvgBatchSize: number;
  predictedDurationMs: number;
  targetDurationMs: number;
  confidence: 'high' | 'medium' | 'low';
};

export type ParallelismRecommendation = {
  connectorId: string;
  recommendedParallelism: number;
  rateLimitedFraction: number;
  cpuCount: number;
};

export type OptimizationBottleneck = 'api_rate_limit' | 'processing_time' | 'memory' | 'unknown';

export type OptimizationReport = {
  connectorId: string;
  workspaceId: string;
  latencyStats: SyncLatencyStats;
  batchSizeRecommendation: BatchSizeRecommendation;
  parallelismRecommendation: ParallelismRecommendation;
  bottleneck: OptimizationBottleneck;
  estimatedThroughputGain: number;
  generatedAt: Date;
};

// ─── Pure utility functions ────────────────────────────────────────────────────

/**
 * Computes a percentile value from a sorted array.
 * @param sorted - Numerically sorted array
 * @param percentile - Value between 0 and 1
 * @returns Interpolated percentile value
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (idx - lower);
}

/**
 * Fits a simple linear regression y = slope * x + intercept.
 * @param points - Array of [x, y] coordinate pairs
 * @returns Slope and intercept
 */
export function linearRegression(points: [number, number][]): { slope: number; intercept: number } {
  if (points.length < 2) return { slope: 0, intercept: 0 };
  const n = points.length;
  const sumX = points.reduce((s, [x]) => s + x, 0);
  const sumY = points.reduce((s, [, y]) => s + y, 0);
  const sumXY = points.reduce((s, [x, y]) => s + x * y, 0);
  const sumX2 = points.reduce((s, [x]) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Predicts optimal batch size to hit targetDurationMs using linear regression.
 * Falls back to defaultBatchSize when regression is unreliable.
 * @param rows - Historical sync metric rows
 * @param targetDurationMs - Target sync duration in milliseconds
 * @param defaultBatchSize - Default batch size fallback
 * @returns Recommended batch size clamped to [10, 1000]
 */
export function predictOptimalBatchSize(
  rows: Pick<SyncMetricRow, 'batch_size' | 'duration_ms' | 'entity_count'>[],
  targetDurationMs: number,
  defaultBatchSize = 100,
): { recommendedBatchSize: number; predictedDurationMs: number; confidence: 'high' | 'medium' | 'low' } {
  if (rows.length < 3) {
    return { recommendedBatchSize: defaultBatchSize, predictedDurationMs: 0, confidence: 'low' };
  }

  const points: [number, number][] = rows.map(r => [r.batch_size, r.duration_ms]);
  const { slope, intercept } = linearRegression(points);

  if (slope <= 0) {
    return { recommendedBatchSize: defaultBatchSize, predictedDurationMs: 0, confidence: 'low' };
  }

  const predicted = (targetDurationMs - intercept) / slope;
  const clamped = Math.max(10, Math.min(1000, Math.round(predicted)));
  const predictedDurationMs = Math.round(slope * clamped + intercept);
  const confidence: 'high' | 'medium' | 'low' = rows.length >= 10 ? 'high' : rows.length >= 5 ? 'medium' : 'low';

  return { recommendedBatchSize: clamped, predictedDurationMs, confidence };
}

/**
 * Determines safe concurrency level given rate-limiting history.
 * @param rows - Historical sync metric rows
 * @param cpuCount - Number of available CPU cores
 * @returns Safe parallelism level
 */
export function computeRecommendedParallelism(
  rows: Pick<SyncMetricRow, 'rate_limited' | 'api_calls'>[],
  cpuCount: number,
): { recommendedParallelism: number; rateLimitedFraction: number } {
  if (rows.length === 0) return { recommendedParallelism: 1, rateLimitedFraction: 0 };
  const rateLimitedCount = rows.filter(r => r.rate_limited).length;
  const rateLimitedFraction = rateLimitedCount / rows.length;
  const maxParallelism = Math.max(1, Math.min(cpuCount, 8));
  // Scale down proportionally to rate limit fraction
  const scaleFactor = Math.max(0.1, 1 - rateLimitedFraction * 2);
  const recommendedParallelism = Math.max(1, Math.round(maxParallelism * scaleFactor));
  return { recommendedParallelism, rateLimitedFraction };
}

/**
 * Identifies the primary sync bottleneck from historical metrics.
 * @param rows - Historical sync metric rows
 * @returns Bottleneck classification
 */
export function detectBottleneck(rows: Pick<SyncMetricRow, 'rate_limited' | 'api_calls' | 'duration_ms' | 'batch_size'>[]): OptimizationBottleneck {
  if (rows.length === 0) return 'unknown';
  const rateLimitedFraction = rows.filter(r => r.rate_limited).length / rows.length;
  if (rateLimitedFraction > 0.3) return 'api_rate_limit';
  const avgApiCallsPerEntity = rows.reduce((s, r) => s + r.api_calls / Math.max(1, r.batch_size), 0) / rows.length;
  const avgMsPerEntity = rows.reduce((s, r) => s + r.duration_ms / Math.max(1, r.batch_size), 0) / rows.length;
  if (avgMsPerEntity > 50 && avgApiCallsPerEntity < 2) return 'processing_time';
  if (rateLimitedFraction > 0.1) return 'api_rate_limit';
  return 'unknown';
}

// ─── SyncOptimizer class ───────────────────────────────────────────────────────

export class SyncOptimizer {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Logs a sync batch metric to the database.
   * @param metric - Metric to record
   * @returns Result of the insert operation
   */
  async logSyncMetric(metric: Omit<SyncMetricRow, 'metric_id' | 'entity_throughput' | 'token_throughput' | 'recorded_at'>): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO sync_metrics (
          connector_id, sync_id, workspace_id,
          batch_size, entity_count, token_count, duration_ms,
          api_calls, rate_limited, error_count
        ) VALUES (
          ${metric.connector_id}, ${metric.sync_id}, ${metric.workspace_id},
          ${metric.batch_size}, ${metric.entity_count}, ${metric.token_count},
          ${metric.duration_ms}, ${metric.api_calls}, ${metric.rate_limited},
          ${metric.error_count}
        )
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Analyzes historical sync metrics for latency percentiles and throughput.
   * @param connectorId - Connector to analyze
   * @param days - Lookback window in days
   * @returns Latency statistics
   */
  async analyzeHistoricalSyncMetrics(connectorId: string, days = 30): Promise<Result<SyncLatencyStats, Error>> {
    try {
      const rows = await this.sql`
        SELECT duration_ms, entity_throughput, token_throughput, error_count
        FROM sync_metrics
        WHERE connector_id = ${connectorId}
          AND recorded_at >= now() - (${days} || ' days')::interval
        ORDER BY duration_ms ASC
      ` as unknown as { duration_ms: number; entity_throughput: number; token_throughput: number; error_count: number }[];

      if (rows.length === 0) {
        return ok({
          p50Ms: 0, p95Ms: 0, p99Ms: 0,
          avgEntityThroughput: 0, avgTokenThroughput: 0,
          totalSyncs: 0, failureRate: 0,
        });
      }

      const durations = rows.map(r => r.duration_ms).sort((a, b) => a - b);
      const failedCount = rows.filter(r => r.error_count > 0).length;

      log.info('Analyzed sync metrics', { connectorId, totalSyncs: rows.length });

      return ok({
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        p99Ms: percentile(durations, 0.99),
        avgEntityThroughput: rows.reduce((s, r) => s + r.entity_throughput, 0) / rows.length,
        avgTokenThroughput: rows.reduce((s, r) => s + r.token_throughput, 0) / rows.length,
        totalSyncs: rows.length,
        failureRate: failedCount / rows.length,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Recommends optimal batch size using linear regression on historical data.
   * @param connectorId - Connector to optimize
   * @param targetDurationMs - Target sync duration in ms
   * @returns Batch size recommendation
   */
  async recommendOptimalBatchSize(connectorId: string, targetDurationMs = 300_000): Promise<Result<BatchSizeRecommendation, Error>> {
    try {
      const rows = await this.sql`
        SELECT batch_size, duration_ms, entity_count
        FROM sync_metrics
        WHERE connector_id = ${connectorId}
        ORDER BY recorded_at DESC
        LIMIT 50
      ` as unknown as Pick<SyncMetricRow, 'batch_size' | 'duration_ms' | 'entity_count'>[];

      const currentAvgBatchSize = rows.length > 0
        ? Math.round(rows.reduce((s, r) => s + r.batch_size, 0) / rows.length)
        : 100;

      const { recommendedBatchSize, predictedDurationMs, confidence } = predictOptimalBatchSize(rows, targetDurationMs);

      log.info('Batch size recommendation computed', { connectorId, recommendedBatchSize, confidence });

      return ok({ connectorId, recommendedBatchSize, currentAvgBatchSize, predictedDurationMs, targetDurationMs, confidence });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Recommends safe parallelism level based on rate-limiting history.
   * @param connectorId - Connector to analyze
   * @param cpuCount - Available CPU cores
   * @returns Parallelism recommendation
   */
  async recommendParallelism(connectorId: string, cpuCount = 4): Promise<Result<ParallelismRecommendation, Error>> {
    try {
      const rows = await this.sql`
        SELECT rate_limited, api_calls
        FROM sync_metrics
        WHERE connector_id = ${connectorId}
        ORDER BY recorded_at DESC
        LIMIT 100
      ` as unknown as Pick<SyncMetricRow, 'rate_limited' | 'api_calls'>[];

      const { recommendedParallelism, rateLimitedFraction } = computeRecommendedParallelism(rows, cpuCount);

      return ok({ connectorId, recommendedParallelism, rateLimitedFraction, cpuCount });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generates a full optimization report identifying bottlenecks and recommendations.
   * @param connectorId - Connector to analyze
   * @param workspaceId - Workspace context
   * @param cpuCount - Available CPU cores
   * @returns Complete optimization report
   */
  async getOptimizationReport(connectorId: string, workspaceId: string, cpuCount = 4): Promise<Result<OptimizationReport, Error>> {
    try {
      const rows = await this.sql`
        SELECT batch_size, duration_ms, entity_count, token_count,
               entity_throughput, api_calls, rate_limited, error_count
        FROM sync_metrics
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
        ORDER BY recorded_at DESC
        LIMIT 100
      ` as unknown as SyncMetricRow[];

      const [latencyResult, batchResult, parallelismResult] = await Promise.all([
        this.analyzeHistoricalSyncMetrics(connectorId),
        this.recommendOptimalBatchSize(connectorId),
        this.recommendParallelism(connectorId, cpuCount),
      ]);

      if (latencyResult.isErr()) return err(latencyResult.error);
      if (batchResult.isErr()) return err(batchResult.error);
      if (parallelismResult.isErr()) return err(parallelismResult.error);

      const bottleneck = detectBottleneck(rows);
      const currentAvgThroughput = rows.length > 0
        ? rows.reduce((s, r) => s + r.entity_throughput, 0) / rows.length
        : 0;

      const optimizedThroughput = batchResult.value.recommendedBatchSize / Math.max(1, batchResult.value.predictedDurationMs / 1000);
      const estimatedThroughputGain = currentAvgThroughput > 0
        ? Math.max(0, (optimizedThroughput - currentAvgThroughput) / currentAvgThroughput)
        : 0;

      log.info('Optimization report generated', { connectorId, workspaceId, bottleneck });

      await this.sql`
        INSERT INTO sync_optimization_recommendations (
          connector_id, workspace_id, recommended_batch_size, recommended_parallelism,
          bottleneck, estimated_throughput_gain
        ) VALUES (
          ${connectorId}, ${workspaceId},
          ${batchResult.value.recommendedBatchSize},
          ${parallelismResult.value.recommendedParallelism},
          ${bottleneck},
          ${estimatedThroughputGain}
        )
        ON CONFLICT (connector_id, workspace_id) DO UPDATE
          SET recommended_batch_size = EXCLUDED.recommended_batch_size,
              recommended_parallelism = EXCLUDED.recommended_parallelism,
              bottleneck = EXCLUDED.bottleneck,
              estimated_throughput_gain = EXCLUDED.estimated_throughput_gain,
              generated_at = now()
      `;

      return ok({
        connectorId,
        workspaceId,
        latencyStats: latencyResult.value,
        batchSizeRecommendation: batchResult.value,
        parallelismRecommendation: parallelismResult.value,
        bottleneck,
        estimatedThroughputGain,
        generatedAt: new Date(),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
