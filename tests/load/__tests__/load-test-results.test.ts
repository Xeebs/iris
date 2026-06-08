import { describe, it, expect } from 'vitest';
import {
  computeLatencyStats,
  formatResult,
  THRESHOLDS,
  type LoadTestResult,
  type LatencyStats,
} from '../load-test-config.js';

describe('computeLatencyStats', () => {
  it('returns zeroes for empty input', () => {
    const stats = computeLatencyStats([]);
    expect(stats.p50).toBe(0);
    expect(stats.p95).toBe(0);
    expect(stats.p99).toBe(0);
    expect(stats.mean).toBe(0);
  });

  it('computes correct p50/p95/p99 for known samples', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = computeLatencyStats(samples);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(100);
    expect(stats.p50).toBe(50);
    expect(stats.p95).toBeGreaterThanOrEqual(94);
    expect(stats.p99).toBeGreaterThanOrEqual(98);
  });

  it('handles single sample', () => {
    const stats = computeLatencyStats([42]);
    expect(stats.p50).toBe(42);
    expect(stats.p95).toBe(42);
    expect(stats.mean).toBe(42);
  });

  it('computes mean correctly', () => {
    const stats = computeLatencyStats([10, 20, 30]);
    expect(stats.mean).toBe(20);
  });

  it('sorts samples before computing percentiles', () => {
    const unsorted = [100, 10, 50, 200, 1];
    const stats = computeLatencyStats(unsorted);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(200);
  });

  it('p95 stays within array bounds for small inputs', () => {
    const stats = computeLatencyStats([5, 10]);
    expect(stats.p95).toBeGreaterThanOrEqual(5);
    expect(stats.p95).toBeLessThanOrEqual(10);
  });
});

describe('THRESHOLDS', () => {
  it('API_P95_MS is 2000ms', () => {
    expect(THRESHOLDS.API_P95_MS).toBe(2000);
  });

  it('MCP_P95_CACHED_MS is 500ms', () => {
    expect(THRESHOLDS.MCP_P95_CACHED_MS).toBe(500);
  });

  it('SYNC_ENTITIES_PER_SEC is 100', () => {
    expect(THRESHOLDS.SYNC_ENTITIES_PER_SEC).toBe(100);
  });
});

function makeResult(overrides: Partial<LoadTestResult> = {}): LoadTestResult {
  const latency: LatencyStats = { p50: 100, p95: 400, p99: 800, min: 20, max: 1200, mean: 150 };
  return {
    scenario: 'test-scenario',
    rps: 50,
    duration: 10,
    totalRequests: 500,
    successRate: 0.99,
    latency,
    errors: [],
    meetsThreshold: true,
    thresholdDetails: 'p95=400ms (threshold: 2000ms)',
    ...overrides,
  };
}

describe('formatResult', () => {
  it('includes PASS for passing result', () => {
    const line = formatResult(makeResult({ meetsThreshold: true }));
    expect(line).toContain('[PASS]');
  });

  it('includes FAIL for failing result', () => {
    const line = formatResult(makeResult({ meetsThreshold: false }));
    expect(line).toContain('[FAIL]');
  });

  it('includes scenario name', () => {
    const line = formatResult(makeResult({ scenario: 'api-stress-test' }));
    expect(line).toContain('api-stress-test');
  });

  it('includes p95 latency', () => {
    const line = formatResult(makeResult());
    expect(line).toContain('p95=400ms');
  });

  it('includes RPS', () => {
    const line = formatResult(makeResult({ rps: 100 }));
    expect(line).toContain('100 RPS');
  });

  it('includes success rate', () => {
    const line = formatResult(makeResult({ successRate: 0.995 }));
    expect(line).toContain('success=99.5%');
  });

  it('includes threshold details', () => {
    const line = formatResult(makeResult({ thresholdDetails: 'p95=300ms (threshold: 2000ms)' }));
    expect(line).toContain('p95=300ms (threshold: 2000ms)');
  });
});

describe('threshold validation logic', () => {
  it('API result passes when p95 <= 2000ms', () => {
    const result = makeResult({ latency: { p50: 100, p95: 1999, p99: 2500, min: 10, max: 3000, mean: 200 } });
    const pass = result.latency.p95 <= THRESHOLDS.API_P95_MS;
    expect(pass).toBe(true);
  });

  it('API result fails when p95 > 2000ms', () => {
    const result = makeResult({ latency: { p50: 100, p95: 2001, p99: 3000, min: 10, max: 4000, mean: 300 } });
    const pass = result.latency.p95 <= THRESHOLDS.API_P95_MS;
    expect(pass).toBe(false);
  });

  it('MCP result passes when cached p95 <= 500ms', () => {
    const pass = 499 <= THRESHOLDS.MCP_P95_CACHED_MS;
    expect(pass).toBe(true);
  });

  it('sync passes when entities/sec >= 100', () => {
    const entitiesPerSec = 150;
    expect(entitiesPerSec >= THRESHOLDS.SYNC_ENTITIES_PER_SEC).toBe(true);
  });

  it('sync fails when entities/sec < 100', () => {
    const entitiesPerSec = 80;
    expect(entitiesPerSec >= THRESHOLDS.SYNC_ENTITIES_PER_SEC).toBe(false);
  });
});
