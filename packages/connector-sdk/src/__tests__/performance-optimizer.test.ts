import { describe, it, expect, vi } from 'vitest';
import {
  adaptiveBatchSize,
  identifyPaginationPattern,
  recommendPaginationType,
  computeOptimalConcurrency,
  estimateSyncDuration,
  PerformanceOptimizer,
} from '../performance-optimizer.js';

// ---------------------------------------------------------------------------
// adaptiveBatchSize
// ---------------------------------------------------------------------------

describe('adaptiveBatchSize', () => {
  it('returns initial batch size for zero processed records', () => {
    const result = adaptiveBatchSize(0, 1024);
    expect(result).toBe(100); // default initial
  });

  it('scales down for large records (> 10MB average)', () => {
    const result = adaptiveBatchSize(5000, 10 * 1024 * 1024);
    // 512MB * 0.1 / 10MB = 5 records; clamped to min (10)
    expect(result).toBe(10);
  });

  it('scales up toward max for small records after warm-up', () => {
    const result = adaptiveBatchSize(2000, 512); // avg 512B, well past warm-up
    // 512MB * 0.1 / 512B = 100000, clamped to max (500)
    expect(result).toBe(500);
  });

  it('stays at initial during warm-up (< 1000 records)', () => {
    const result = adaptiveBatchSize(500, 512);
    // Still in warm-up — should not exceed initial (100)
    expect(result).toBeLessThanOrEqual(100);
  });

  it('respects custom min/max bounds', () => {
    const config = { min: 5, max: 50, initial: 20 };
    const result = adaptiveBatchSize(2000, 256, 512 * 1024 * 1024, config);
    expect(result).toBeLessThanOrEqual(50);
    expect(result).toBeGreaterThanOrEqual(5);
  });

  it('handles zero avg record size gracefully', () => {
    const result = adaptiveBatchSize(100, 0);
    expect(result).toBe(100); // falls back to initial
  });
});

// ---------------------------------------------------------------------------
// identifyPaginationPattern
// ---------------------------------------------------------------------------

describe('identifyPaginationPattern', () => {
  it('returns cursor when requests use cursor pagination', () => {
    const requests = [
      { type: 'cursor' as const, hasNextCursor: true, nextCursor: 'abc' },
      { type: 'cursor' as const, hasNextCursor: true, nextCursor: 'def' },
    ];
    expect(identifyPaginationPattern(requests)).toBe('cursor');
  });

  it('returns offset when requests use offset pagination', () => {
    const requests = [
      { type: 'offset' as const, offset: 0, totalCount: 500 },
      { type: 'offset' as const, offset: 100, totalCount: 500 },
    ];
    expect(identifyPaginationPattern(requests)).toBe('offset');
  });

  it('returns keyset for keyset pagination type', () => {
    const requests = [{ type: 'keyset' as const }, { type: 'keyset' as const }];
    expect(identifyPaginationPattern(requests)).toBe('keyset');
  });

  it('defaults to cursor for empty request list', () => {
    expect(identifyPaginationPattern([])).toBe('cursor');
  });

  it('prefers cursor over offset when mixed signals', () => {
    const requests = [
      { type: 'cursor' as const, hasNextCursor: true },
      { type: 'offset' as const, offset: 0 },
      { type: 'cursor' as const, nextCursor: 'xyz' },
    ];
    expect(identifyPaginationPattern(requests)).toBe('cursor');
  });
});

// ---------------------------------------------------------------------------
// recommendPaginationType
// ---------------------------------------------------------------------------

describe('recommendPaginationType', () => {
  it('marks cursor as optimal', () => {
    const rec = recommendPaginationType('cursor');
    expect(rec.isOptimal).toBe(true);
    expect(rec.type).toBe('cursor');
  });

  it('marks keyset as optimal', () => {
    const rec = recommendPaginationType('keyset');
    expect(rec.isOptimal).toBe(true);
  });

  it('marks offset as non-optimal with a reason', () => {
    const rec = recommendPaginationType('offset');
    expect(rec.isOptimal).toBe(false);
    expect(rec.reason).toMatch(/offset/i);
  });
});

// ---------------------------------------------------------------------------
// computeOptimalConcurrency
// ---------------------------------------------------------------------------

describe('computeOptimalConcurrency', () => {
  it('returns minimum concurrency on high error rate', () => {
    const result = computeOptimalConcurrency(10, 200, 0.15);
    expect(result).toBe(1); // error rate >= 10%
  });

  it('applies Little\'s Law: concurrency = rateLimit × avgLatency(s)', () => {
    // 10 req/s × 300ms = 3 concurrent
    const result = computeOptimalConcurrency(10, 300, 0);
    expect(result).toBe(3);
  });

  it('caps concurrency at max', () => {
    // Very high rate limit would push > max
    const result = computeOptimalConcurrency(100, 1000, 0); // 100 req/s × 1s = 100
    expect(result).toBe(10); // clamped to max
  });

  it('stays at initial when error rate > 1%', () => {
    // Without error, 10 req/s × 2s = 20 → clamped to max 10
    // With error rate 0.05 → should not exceed initial (3)
    const result = computeOptimalConcurrency(10, 2000, 0.05);
    expect(result).toBe(3); // error rate > 1% → stays at initial
  });

  it('falls back to initial when no rate limit provided', () => {
    const result = computeOptimalConcurrency(0, 200, 0);
    expect(result).toBe(3); // default initial
  });
});

// ---------------------------------------------------------------------------
// estimateSyncDuration
// ---------------------------------------------------------------------------

describe('estimateSyncDuration', () => {
  it('returns zero estimate when no records processed yet', () => {
    const result = estimateSyncDuration(10000, 0, 5000);
    expect(result.currentThroughputPerSec).toBe(0);
    expect(result.estimatedCompletionMs).toBe(0);
  });

  it('estimates remaining time based on throughput', () => {
    // Processed 1000 records in 10s → 100/s; 9000 remaining → 90s remaining
    const result = estimateSyncDuration(10000, 1000, 10_000);
    expect(result.currentThroughputPerSec).toBeCloseTo(100);
    expect(result.estimatedCompletionMs).toBeCloseTo(90_000, -2);
  });

  it('sets exceedsMaxDuration=true when estimate > limit', () => {
    // 100 records in 1s → 100/s; 1M remaining → 10000s — exceeds 30min
    const result = estimateSyncDuration(1_000_100, 100, 1000);
    expect(result.exceedsMaxDuration).toBe(true);
  });

  it('sets exceedsMaxDuration=false for fast syncs', () => {
    // 9000 records in 1s → 9000/s; 1000 remaining → ~111ms
    const result = estimateSyncDuration(10000, 9000, 1000);
    expect(result.exceedsMaxDuration).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PerformanceOptimizer (stateful)
// ---------------------------------------------------------------------------

describe('PerformanceOptimizer', () => {
  it('tracks processed records and provides batch size recommendations', () => {
    const opt = new PerformanceOptimizer('hubspot', 50000, 10);
    opt.recordBatch(100, 100 * 1024, false); // 100 records × 1KB
    const size = opt.getBatchSize();
    expect(size).toBeGreaterThanOrEqual(10);
    expect(size).toBeLessThanOrEqual(500);
  });

  it('reduces concurrency after errors', () => {
    const opt = new PerformanceOptimizer('salesforce', 10000, 10);
    // Record many errors
    for (let i = 0; i < 10; i++) {
      opt.recordBatch(10, 10 * 1024, true); // all errors
    }
    const concurrency = opt.getConcurrency(200);
    expect(concurrency).toBe(1); // 100% error rate → minimum
  });

  it('returns duration estimate with remaining records', () => {
    const opt = new PerformanceOptimizer('hubspot', 5000, 10);
    opt.recordBatch(1000, 1000 * 1024, false);
    const est = opt.getDurationEstimate();
    expect(est.estimatedRemainingRecords).toBe(4000);
    expect(est.currentThroughputPerSec).toBeGreaterThan(0);
  });
});
