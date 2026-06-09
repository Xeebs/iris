export const BASE_URL = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3001';
export const MCP_URL = process.env.LOAD_TEST_MCP_URL ?? 'http://localhost:3000';

export const THRESHOLDS = {
  API_P95_MS: 2000,
  MCP_P95_CACHED_MS: 500,
  SYNC_ENTITIES_PER_SEC: 100,
};

/**
 * @param {number[]} samples
 * @returns {{ p50: number, p95: number, p99: number, min: number, max: number, mean: number }}
 */
export function computeLatencyStats(samples) {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.floor((p / 100) * (sorted.length - 1))] ?? 0;
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
 * @param {{ scenario: string, rps: number, meetsThreshold: boolean, latency: { p50: number, p95: number, p99: number }, successRate: number, thresholdDetails: string }} result
 * @returns {string}
 */
export function formatResult(result) {
  const status = result.meetsThreshold ? 'PASS' : 'FAIL';
  return `[${status}] ${result.scenario} @ ${result.rps} RPS — p50=${result.latency.p50}ms p95=${result.latency.p95}ms p99=${result.latency.p99}ms success=${(result.successRate * 100).toFixed(1)}% | ${result.thresholdDetails}`;
}
