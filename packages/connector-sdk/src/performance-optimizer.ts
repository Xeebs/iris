import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'performance-optimizer' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaginationType = 'cursor' | 'keyset' | 'offset';
export type ConnectorType = string;

export interface BatchSizeConfig {
  min: number;
  max: number;
  initial: number;
}

const DEFAULT_BATCH_CONFIG: BatchSizeConfig = { min: 10, max: 500, initial: 100 };
const MAX_MEMORY_BYTES = 512 * 1024 * 1024; // 512 MB default

export interface PaginationRequest {
  type: 'cursor' | 'offset' | 'keyset' | 'unknown';
  pageSize?: number;
  hasNextCursor?: boolean;
  nextCursor?: string;
  offset?: number;
  totalCount?: number;
}

export interface ConcurrencyConfig {
  min: number;
  max: number;
  initial: number;
}

const DEFAULT_CONCURRENCY: ConcurrencyConfig = { min: 1, max: 10, initial: 3 };

export interface SyncDurationEstimate {
  estimatedCompletionMs: number;
  estimatedRemainingRecords: number;
  currentThroughputPerSec: number;
  exceedsMaxDuration: boolean;
}

// ---------------------------------------------------------------------------
// Adaptive Batch Sizing
// ---------------------------------------------------------------------------

/**
 * Auto-tune the batch size based on actual record size and available memory.
 * Starts at `initial` (default 100), scales up toward `max` (500) for small records,
 * scales down toward `min` (10) when records are large.
 *
 * @param recordsProcessedSoFar - Total records processed in this sync run
 * @param avgRecordSizeBytes - Observed average size per record in bytes
 * @param maxMemoryBytes - Memory ceiling for the batch (default 512MB)
 * @param config - Min/max/initial bounds
 * @returns Recommended batch size for the next page fetch
 */
export function adaptiveBatchSize(
  recordsProcessedSoFar: number,
  avgRecordSizeBytes: number,
  maxMemoryBytes: number = MAX_MEMORY_BYTES,
  config: BatchSizeConfig = DEFAULT_BATCH_CONFIG,
): number {
  if (avgRecordSizeBytes <= 0) return config.initial;

  // How many records fit in 10% of the memory budget (leave room for other allocations)
  const memoryBudgetBytes = maxMemoryBytes * 0.1;
  const memoryBasedMax = Math.floor(memoryBudgetBytes / avgRecordSizeBytes);

  // After 1000 records with stable sizing, allow scaling up
  const warmUp = recordsProcessedSoFar < 1000;
  const upperBound = warmUp ? config.initial : Math.min(config.max, memoryBasedMax);
  const lowerBound = config.min;

  const recommended = Math.max(lowerBound, Math.min(upperBound, memoryBasedMax));

  log.debug('Adaptive batch size computed', {
    recordsProcessedSoFar,
    avgRecordSizeBytes,
    memoryBasedMax,
    recommended,
  });

  return recommended;
}

// ---------------------------------------------------------------------------
// Pagination Pattern Detection
// ---------------------------------------------------------------------------

/**
 * Identify which pagination strategy a connector's API uses and recommend the best.
 * Cursor > Keyset > Offset for large-scale live data.
 *
 * @param requests - Sample of recent pagination requests/responses
 * @returns Detected pagination type
 */
export function identifyPaginationPattern(requests: PaginationRequest[]): PaginationType {
  if (requests.length === 0) return 'cursor';

  let cursorCount = 0;
  let offsetCount = 0;
  let keysetCount = 0;

  for (const req of requests) {
    if (req.type === 'cursor' || req.hasNextCursor || req.nextCursor) {
      cursorCount++;
    } else if (req.type === 'keyset') {
      keysetCount++;
    } else if (req.type === 'offset' || req.offset !== undefined) {
      offsetCount++;
    }
  }

  if (cursorCount >= offsetCount && cursorCount >= keysetCount) return 'cursor';
  if (keysetCount >= offsetCount) return 'keyset';
  return 'offset';
}

/**
 * Return the recommended (most efficient) pagination type to use for a connector.
 * Cursor is always preferred; if the API only supports offset, flag it as a limitation.
 *
 * @param detected - The detected pagination type
 */
export function recommendPaginationType(detected: PaginationType): {
  type: PaginationType;
  isOptimal: boolean;
  reason: string;
} {
  switch (detected) {
    case 'cursor':
      return { type: 'cursor', isOptimal: true, reason: 'Cursor pagination is optimal for live data' };
    case 'keyset':
      return {
        type: 'keyset',
        isOptimal: true,
        reason: 'Keyset pagination avoids offset drift on insertions',
      };
    case 'offset':
      return {
        type: 'offset',
        isOptimal: false,
        reason: 'Offset pagination can miss/duplicate records on concurrent writes — prefer cursor if available',
      };
  }
}

// ---------------------------------------------------------------------------
// Optimal Concurrency
// ---------------------------------------------------------------------------

/**
 * Auto-scale parallel request concurrency for a connector.
 * Starts at `initial` (3), scales up toward `max` (10) if error rate is low,
 * scales down toward `min` (1) if error rate is high.
 *
 * @param rateLimit - API rate limit in requests per second (0 = no known limit)
 * @param avgLatencyMs - Average observed latency per API request in ms
 * @param errorRate - Fraction of recent requests that errored (0.0 – 1.0)
 * @param config - Min/max/initial concurrency bounds
 * @returns Recommended concurrency level
 */
export function computeOptimalConcurrency(
  rateLimit: number,
  avgLatencyMs: number,
  errorRate: number,
  config: ConcurrencyConfig = DEFAULT_CONCURRENCY,
): number {
  if (errorRate >= 0.1) {
    // High error rate — back off to minimum
    log.warn('High error rate, reducing concurrency to minimum', { errorRate });
    return config.min;
  }

  // Little's Law: optimal concurrency ≈ throughput × latency
  // throughput = rateLimit (req/s), latency = avgLatencyMs/1000 (s)
  const littlesConcurrency =
    rateLimit > 0 && avgLatencyMs > 0
      ? Math.floor(rateLimit * (avgLatencyMs / 1000))
      : config.initial;

  let recommended = Math.max(config.min, Math.min(config.max, littlesConcurrency));

  // Only scale above initial if error rate is very low
  if (errorRate > 0.01 && recommended > config.initial) {
    recommended = config.initial;
  }

  log.debug('Optimal concurrency computed', {
    rateLimit,
    avgLatencyMs,
    errorRate,
    recommended,
  });

  return recommended;
}

// ---------------------------------------------------------------------------
// Sync Duration Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate when a sync will complete given remaining records and current throughput.
 *
 * @param totalRecords - Total number of records to sync
 * @param processedRecords - Records synced so far
 * @param elapsedMs - Elapsed time in milliseconds
 * @param maxDurationMs - Maximum allowed duration before alerting (default: 30 min)
 * @returns Duration estimate with flag if over budget
 */
export function estimateSyncDuration(
  totalRecords: number,
  processedRecords: number,
  elapsedMs: number,
  maxDurationMs: number = 30 * 60 * 1000,
): SyncDurationEstimate {
  const remainingRecords = Math.max(0, totalRecords - processedRecords);

  if (elapsedMs <= 0 || processedRecords <= 0) {
    return {
      estimatedCompletionMs: 0,
      estimatedRemainingRecords: remainingRecords,
      currentThroughputPerSec: 0,
      exceedsMaxDuration: false,
    };
  }

  const throughputPerSec = (processedRecords / elapsedMs) * 1000;
  const estimatedRemainingMs =
    throughputPerSec > 0 ? (remainingRecords / throughputPerSec) * 1000 : 0;
  const estimatedCompletionMs = estimatedRemainingMs;

  const exceedsMaxDuration = estimatedCompletionMs > maxDurationMs;
  if (exceedsMaxDuration) {
    log.warn('Sync duration estimate exceeds maximum', {
      estimatedCompletionMs,
      maxDurationMs,
      remainingRecords,
      throughputPerSec,
    });
  }

  return {
    estimatedCompletionMs,
    estimatedRemainingRecords: remainingRecords,
    currentThroughputPerSec: throughputPerSec,
    exceedsMaxDuration,
  };
}

// ---------------------------------------------------------------------------
// PerformanceOptimizer class (stateful across a sync run)
// ---------------------------------------------------------------------------

/**
 * Stateful optimizer that tracks a sync run and provides tuning recommendations.
 * One instance per sync run.
 */
export class PerformanceOptimizer {
  private processedRecords = 0;
  private totalBytesProcessed = 0;
  private recentErrors = 0;
  private recentRequests = 0;
  private startedAt: number = Date.now();

  constructor(
    private readonly connectorType: ConnectorType,
    private readonly totalRecordsEstimate: number,
    private readonly rateLimit: number = 0,
  ) {}

  /**
   * Record that a batch was processed.
   *
   * @param recordCount - Number of records in the batch
   * @param totalBatchBytes - Total byte size of the batch
   * @param hadError - Whether the batch request errored
   */
  recordBatch(recordCount: number, totalBatchBytes: number, hadError: boolean): void {
    this.processedRecords += recordCount;
    this.totalBytesProcessed += totalBatchBytes;
    this.recentRequests++;
    if (hadError) this.recentErrors++;
  }

  /** Get the recommended batch size for the next page fetch. */
  getBatchSize(config?: BatchSizeConfig): number {
    const avgSize =
      this.processedRecords > 0 ? this.totalBytesProcessed / this.processedRecords : 1024;
    return adaptiveBatchSize(this.processedRecords, avgSize, MAX_MEMORY_BYTES, config);
  }

  /** Get the recommended concurrency level given current performance. */
  getConcurrency(avgLatencyMs: number, config?: ConcurrencyConfig): number {
    const errorRate = this.recentRequests > 0 ? this.recentErrors / this.recentRequests : 0;
    return computeOptimalConcurrency(this.rateLimit, avgLatencyMs, errorRate, config);
  }

  /** Get a sync duration estimate. */
  getDurationEstimate(maxDurationMs?: number): SyncDurationEstimate {
    const elapsedMs = Math.max(1, Date.now() - this.startedAt);
    return estimateSyncDuration(
      this.totalRecordsEstimate,
      this.processedRecords,
      elapsedMs,
      maxDurationMs,
    );
  }
}
