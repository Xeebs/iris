import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenAnalytics } from '../token-analytics.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const mockSql = Object.assign(vi.fn(), { json: vi.fn() });

describe('TokenAnalytics', () => {
  let analytics: TokenAnalytics;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { TokenAnalytics: TA } = await import('../token-analytics.js');
    analytics = new TA(mockSql as unknown as Parameters<typeof TA>[0]);
  });

  describe('logQuery', () => {
    it('inserts a token event row successfully', async () => {
      mockSql.mockResolvedValueOnce([]);

      const result = await analytics.logQuery('ws-1', {
        tokensSpent: 500,
        tokensSavedByCaching: 200,
        tokensSavedByCompression: 50,
        toolName: 'query-context',
        cacheHit: true,
      });

      expect(result.isOk()).toBe(true);
      expect(mockSql).toHaveBeenCalledOnce();
    });

    it('returns error when insert fails', async () => {
      mockSql.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await analytics.logQuery('ws-1', {
        tokensSpent: 100,
        tokensSavedByCaching: 0,
        tokensSavedByCompression: 0,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('DB connection lost');
    });
  });

  describe('getAnalytics', () => {
    it('aggregates daily summaries from token event rows', async () => {
      mockSql.mockResolvedValueOnce([
        {
          date: '2026-06-04',
          tokens_spent: '1000',
          tokens_saved_caching: '400',
          tokens_saved_compression: '100',
          query_count: '10',
          cache_hits: '6',
        },
        {
          date: '2026-06-03',
          tokens_spent: '800',
          tokens_saved_caching: '200',
          tokens_saved_compression: '80',
          query_count: '8',
          cache_hits: '3',
        },
      ]);

      const result = await analytics.getAnalytics('ws-1', 30);

      expect(result.isOk()).toBe(true);
      const summary = result._unsafeUnwrap();
      expect(summary.days).toHaveLength(2);

      const day1 = summary.days[0]!;
      expect(day1.date).toBe('2026-06-04');
      expect(day1.tokensSpent).toBe(1000);
      expect(day1.tokensSavedByCaching).toBe(400);
      expect(day1.tokensSavedByCompression).toBe(100);
      expect(day1.totalTokensSaved).toBe(500);
      expect(day1.queryCount).toBe(10);
      expect(day1.cacheHitRate).toBeCloseTo(0.6);
    });

    it('computes correct totals across days', async () => {
      mockSql.mockResolvedValueOnce([
        {
          date: '2026-06-04',
          tokens_spent: '1000',
          tokens_saved_caching: '400',
          tokens_saved_compression: '100',
          query_count: '10',
          cache_hits: '6',
        },
      ]);

      const result = await analytics.getAnalytics('ws-1');
      const summary = result._unsafeUnwrap();

      expect(summary.totals.tokensSpent).toBe(1000);
      expect(summary.totals.tokensSaved).toBe(500);
      expect(summary.totals.cacheHitRate).toBeCloseTo(0.6);
      expect(summary.totals.compressionRatio).toBeCloseTo(1.5);
    });

    it('returns zero-rate when no queries', async () => {
      mockSql.mockResolvedValueOnce([]);

      const result = await analytics.getAnalytics('ws-empty');
      const summary = result._unsafeUnwrap();

      expect(summary.days).toHaveLength(0);
      expect(summary.totals.cacheHitRate).toBe(0);
      expect(summary.totals.compressionRatio).toBe(1);
    });

    it('returns error when query fails', async () => {
      mockSql.mockRejectedValueOnce(new Error('Query timeout'));

      const result = await analytics.getAnalytics('ws-1');

      expect(result.isErr()).toBe(true);
    });
  });
});
