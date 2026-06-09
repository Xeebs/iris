import { logger } from '@iris/core/logger';

export type BenchmarkSize = 1000 | 10000 | 100000;

export type BenchmarkConfig = {
  dataSize: BenchmarkSize;
  timeoutMs?: number;
  warmupRuns?: number;
};

export type BenchmarkMetrics = {
  connectorId: string;
  entityType: string;
  dataSize: number;
  durationMs: number;
  throughputPerSec: number;
  memoryPeakMb: number;
  apiCallCount: number;
  errorRate: number;
  avgTransformMs: number;
  runAt: Date;
};

export type BenchmarkComparison = {
  entityType: string;
  connectorIds: string[];
  rankings: {
    fastest: string;
    lowestMemory: string;
    mostReliable: string;
  };
  results: BenchmarkMetrics[];
};

export type BenchmarkBaseline = {
  connectorId: string;
  entityType: string;
  baselineThroughput: number;
  baselineMemoryMb: number;
  measuredAt: Date;
};

export type RegressionReport = {
  connectorId: string;
  entityType: string;
  hasRegression: boolean;
  throughputDeltaPct: number;
  memoryDeltaPct: number;
  details: string;
};

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

type BenchmarkResultRow = {
  benchmark_id: string;
  connector_id: string;
  entity_type: string;
  data_size: number;
  duration_ms: number;
  throughput_per_sec: number;
  memory_peak_mb: number;
  api_call_count: number;
  error_rate: number;
  avg_transform_ms: number;
  run_at: Date;
};

export class ConnectorBenchmarker {
  constructor(private readonly sql: Sql) {}

  /**
   * Define and execute a benchmark run against a connector.
   * @param connectorId - Connector to benchmark
   * @param entityType - Entity type to measure
   * @param syncFn - The sync function to time (generator that yields entity objects)
   * @param config - Benchmark configuration
   * @returns Collected metrics
   */
  async executeBenchmark(
    connectorId: string,
    entityType: string,
    syncFn: () => AsyncIterable<unknown>,
    config: BenchmarkConfig = { dataSize: 1000 },
  ): Promise<BenchmarkMetrics> {
    const { dataSize, timeoutMs = 60_000, warmupRuns = 1 } = config;

    // Warmup
    for (let i = 0; i < warmupRuns; i++) {
      const gen = syncFn();
      let count = 0;
      for await (const _ of gen) {
        if (++count >= 10) break;
      }
    }

    const startMem = process.memoryUsage().heapUsed;
    const startTime = performance.now();
    let entityCount = 0;
    let apiCalls = 0;
    let errors = 0;
    let totalTransformMs = 0;
    let peakMem = startMem;

    const timeoutSignal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : null;

    try {
      const gen = syncFn();
      for await (const entity of gen) {
        if (timeoutSignal?.aborted) break;
        if (entity === null || entity === undefined) {
          errors++;
          continue;
        }

        const transformStart = performance.now();
        if (typeof entity === 'object') {
          void Object.keys(entity as object).length;
        }
        totalTransformMs += performance.now() - transformStart;

        entityCount++;
        apiCalls += Math.ceil(entityCount / 100); // estimate: 1 API call per 100 entities

        const currentMem = process.memoryUsage().heapUsed;
        if (currentMem > peakMem) peakMem = currentMem;

        if (entityCount >= dataSize) break;
      }
    } catch (err) {
      errors++;
      logger.warn('Benchmark run encountered error', { connectorId, entityType, error: err instanceof Error ? err.message : String(err) });
    }

    const durationMs = performance.now() - startTime;
    const throughputPerSec = durationMs > 0 ? (entityCount / durationMs) * 1000 : 0;
    const memoryPeakMb = (peakMem - startMem) / 1_048_576;

    const metrics: BenchmarkMetrics = {
      connectorId,
      entityType,
      dataSize,
      durationMs: Math.round(durationMs * 100) / 100,
      throughputPerSec: Math.round(throughputPerSec * 10) / 10,
      memoryPeakMb: Math.max(0, Math.round(memoryPeakMb * 100) / 100),
      apiCallCount: Math.max(1, apiCalls),
      errorRate: entityCount > 0 ? errors / (entityCount + errors) : 0,
      avgTransformMs: entityCount > 0 ? Math.round((totalTransformMs / entityCount) * 100) / 100 : 0,
      runAt: new Date(),
    };

    await this.persistResult(metrics);
    return metrics;
  }

  /**
   * Compare multiple connectors for the same entity type.
   * @param connectorResults - Pre-collected metrics per connector
   * @returns Ranked comparison
   */
  compareConnectors(connectorResults: BenchmarkMetrics[]): BenchmarkComparison {
    if (connectorResults.length === 0) {
      throw new Error('No results to compare');
    }

    const entityType = connectorResults[0]!.entityType;
    const connectorIds = connectorResults.map((r) => r.connectorId);

    const fastest = connectorResults.reduce((best, r) =>
      r.throughputPerSec > best.throughputPerSec ? r : best
    ).connectorId;

    const lowestMemory = connectorResults.reduce((best, r) =>
      r.memoryPeakMb < best.memoryPeakMb ? r : best
    ).connectorId;

    const mostReliable = connectorResults.reduce((best, r) =>
      r.errorRate < best.errorRate ? r : best
    ).connectorId;

    return {
      entityType,
      connectorIds,
      rankings: { fastest, lowestMemory, mostReliable },
      results: connectorResults.sort((a, b) => b.throughputPerSec - a.throughputPerSec),
    };
  }

  /**
   * Check if a connector's recent performance has regressed vs its stored baseline.
   * @param connectorId - Connector to check
   * @param entityType - Entity type
   * @param currentMetrics - Most recent benchmark run
   * @param baseline - Historical baseline to compare against
   * @returns Regression report
   */
  detectPerformanceRegression(
    connectorId: string,
    entityType: string,
    currentMetrics: BenchmarkMetrics,
    baseline: BenchmarkBaseline,
  ): RegressionReport {
    const REGRESSION_THRESHOLD = 0.10; // 10%

    const throughputDelta = baseline.baselineThroughput > 0
      ? (currentMetrics.throughputPerSec - baseline.baselineThroughput) / baseline.baselineThroughput
      : 0;

    const memoryDelta = baseline.baselineMemoryMb > 0
      ? (currentMetrics.memoryPeakMb - baseline.baselineMemoryMb) / baseline.baselineMemoryMb
      : 0;

    const hasThroughputRegression = throughputDelta < -REGRESSION_THRESHOLD;
    const hasMemoryRegression = memoryDelta > REGRESSION_THRESHOLD;
    const hasRegression = hasThroughputRegression || hasMemoryRegression;

    const details: string[] = [];
    if (hasThroughputRegression) {
      details.push(`Throughput dropped ${Math.abs(throughputDelta * 100).toFixed(1)}% (${baseline.baselineThroughput.toFixed(1)} → ${currentMetrics.throughputPerSec.toFixed(1)} entities/s)`);
    }
    if (hasMemoryRegression) {
      details.push(`Memory increased ${(memoryDelta * 100).toFixed(1)}% (${baseline.baselineMemoryMb.toFixed(2)} → ${currentMetrics.memoryPeakMb.toFixed(2)} MB)`);
    }
    if (!hasRegression) {
      details.push('Performance within normal bounds');
    }

    return {
      connectorId,
      entityType,
      hasRegression,
      throughputDeltaPct: Math.round(throughputDelta * 1000) / 10,
      memoryDeltaPct: Math.round(memoryDelta * 1000) / 10,
      details: details.join('; '),
    };
  }

  /**
   * Fetch historical benchmark results for a connector.
   * @param connectorId - Connector ID
   * @param entityType - Entity type filter (optional)
   * @param limit - Max results
   */
  async getResults(connectorId: string, entityType?: string, limit = 20): Promise<BenchmarkMetrics[]> {
    try {
      let rows: BenchmarkResultRow[];
      if (entityType) {
        rows = await this.sql`
          SELECT benchmark_id, connector_id, entity_type, data_size, duration_ms,
                 throughput_per_sec, memory_peak_mb, api_call_count, error_rate, avg_transform_ms, run_at
          FROM connector_benchmarks
          WHERE connector_id = ${connectorId} AND entity_type = ${entityType}
          ORDER BY run_at DESC
          LIMIT ${limit}
        ` as BenchmarkResultRow[];
      } else {
        rows = await this.sql`
          SELECT benchmark_id, connector_id, entity_type, data_size, duration_ms,
                 throughput_per_sec, memory_peak_mb, api_call_count, error_rate, avg_transform_ms, run_at
          FROM connector_benchmarks
          WHERE connector_id = ${connectorId}
          ORDER BY run_at DESC
          LIMIT ${limit}
        ` as BenchmarkResultRow[];
      }

      return rows.map(rowToMetrics);
    } catch {
      return [];
    }
  }

  /**
   * Generate a benchmark matrix across all connectors and entity types.
   * @param connectorIds - List of connectors
   * @param entityTypes - List of entity types
   */
  async getBenchmarkMatrix(
    connectorIds: string[],
    entityTypes: string[],
  ): Promise<Record<string, Record<string, BenchmarkMetrics | null>>> {
    const matrix: Record<string, Record<string, BenchmarkMetrics | null>> = {};

    for (const entityType of entityTypes) {
      matrix[entityType] = {};
      for (const connectorId of connectorIds) {
        const results = await this.getResults(connectorId, entityType, 1);
        matrix[entityType]![connectorId] = results[0] ?? null;
      }
    }

    return matrix;
  }

  private async persistResult(metrics: BenchmarkMetrics): Promise<void> {
    try {
      await this.sql`
        INSERT INTO connector_benchmarks
          (connector_id, entity_type, data_size, duration_ms, throughput_per_sec,
           memory_peak_mb, api_call_count, error_rate, avg_transform_ms, run_at)
        VALUES
          (${metrics.connectorId}, ${metrics.entityType}, ${metrics.dataSize},
           ${metrics.durationMs}, ${metrics.throughputPerSec}, ${metrics.memoryPeakMb},
           ${metrics.apiCallCount}, ${metrics.errorRate}, ${metrics.avgTransformMs}, ${metrics.runAt})
      `;
    } catch (err) {
      logger.warn('Failed to persist benchmark result', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

function rowToMetrics(row: BenchmarkResultRow): BenchmarkMetrics {
  return {
    connectorId: row.connector_id,
    entityType: row.entity_type,
    dataSize: row.data_size,
    durationMs: row.duration_ms,
    throughputPerSec: row.throughput_per_sec,
    memoryPeakMb: row.memory_peak_mb,
    apiCallCount: row.api_call_count,
    errorRate: row.error_rate,
    avgTransformMs: row.avg_transform_ms,
    runAt: row.run_at,
  };
}
