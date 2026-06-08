export const BASE_URL = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3001';
export const MCP_URL = process.env.LOAD_TEST_MCP_URL ?? 'http://localhost:3000';

export const THRESHOLDS = {
  /** p95 API latency for cache-miss queries (ms) */
  API_P95_MS: 2000,
  /** p95 MCP tool latency for cached responses (ms) */
  MCP_P95_CACHED_MS: 500,
  /** Minimum entity throughput for connector sync */
  SYNC_ENTITIES_PER_SEC: 100,
} as const;

export type LatencyStats = {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
};

export type LoadTestResult = {
  scenario: string;
  rps: number;
  duration: number;
  totalRequests: number;
  successRate: number;
  latency: LatencyStats;
  errors: string[];
  peakMemoryMb?: number;
  cacheHitRate?: number;
  entitiesPerSec?: number;
  meetsThreshold: boolean;
  thresholdDetails: string;
};

/**
 * Compute latency percentiles from a sorted array of durations.
 * @param samples - Array of latency measurements in milliseconds
 * @returns Computed latency statistics
 */
export function computeLatencyStats(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.floor((p / 100) * (sorted.length - 1))] ?? 0;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: Math.round(sum / sorted.length),
  };
}

/**
 * Format a LoadTestResult as a human-readable summary line.
 * @param result - Load test result to format
 * @returns Single-line summary string
 */
export function formatResult(result: LoadTestResult): string {
  const status = result.meetsThreshold ? 'PASS' : 'FAIL';
  return `[${status}] ${result.scenario} @ ${result.rps} RPS — p50=${result.latency.p50}ms p95=${result.latency.p95}ms p99=${result.latency.p99}ms success=${(result.successRate * 100).toFixed(1)}% | ${result.thresholdDetails}`;
}
