import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryPerformanceAnalyzer } from '../query-performance-analyzer.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn((..._args: unknown[]) => Promise.resolve([]));
}

describe('QueryPerformanceAnalyzer', () => {
  let sql: ReturnType<typeof makeSql>;
  let analyzer: QueryPerformanceAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSql();
    analyzer = new QueryPerformanceAnalyzer(sql as unknown as Parameters<typeof QueryPerformanceAnalyzer>[0]);
  });

  describe('logQueryMetrics', () => {
    it('inserts query metrics and returns ok', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await analyzer.logQueryMetrics('ws-1', 'find all contacts', {
        executionTimeMs: 350,
        embeddingTimeMs: 80,
        vectorSearchTimeMs: 200,
        resultSize: 5,
      });
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledOnce();
    });

    it('hashes query text consistently', async () => {
      sql.mockResolvedValue([]);
      await analyzer.logQueryMetrics('ws-1', 'same query', { executionTimeMs: 100 });
      await analyzer.logQueryMetrics('ws-1', 'same query', { executionTimeMs: 200 });
      const [call1Args, call2Args] = sql.mock.calls as [unknown[], unknown[]][];
      const firstCallValues = call1Args?.slice(1) as string[];
      const secondCallValues = call2Args?.slice(1) as string[];
      // query_hash should be the same for same query text
      expect(firstCallValues[1]).toBe(secondCallValues[1]);
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('connection refused'));
      const result = await analyzer.logQueryMetrics('ws-1', 'query', { executionTimeMs: 50 });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('analyzeSlowQueries', () => {
    it('returns mapped slow query records', async () => {
      const mockRows = [
        {
          query_hash: 'abc123',
          query_text: 'find contacts in ACME',
          call_count: '15',
          p50_ms: 800,
          p95_ms: 2500,
          avg_result_size: 10,
        },
        {
          query_hash: 'def456',
          query_text: 'revenue metrics',
          call_count: '8',
          p50_ms: 1200,
          p95_ms: 3200,
          avg_result_size: 3,
        },
      ];
      sql.mockResolvedValueOnce(mockRows);
      const result = await analyzer.analyzeSlowQueries('ws-1');
      expect(result.isOk()).toBe(true);
      const queries = result._unsafeUnwrap();
      expect(queries).toHaveLength(2);
      expect(queries[0]?.queryHash).toBe('abc123');
      expect(queries[0]?.p95Ms).toBe(2500);
      expect(queries[0]?.callCount).toBe(15);
    });

    it('returns empty array when no slow queries exist', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await analyzer.analyzeSlowQueries('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('timeout'));
      const result = await analyzer.analyzeSlowQueries('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('analyzeQueryPatterns', () => {
    it('returns entity access frequency data', async () => {
      const mockRows = [
        { entity_id: 'hubspot:contact:1', access_count: '42', last_accessed: new Date() },
        { entity_id: 'hubspot:company:5', access_count: '28', last_accessed: new Date() },
      ];
      sql.mockResolvedValueOnce(mockRows);
      const result = await analyzer.analyzeQueryPatterns('ws-1');
      expect(result.isOk()).toBe(true);
      const entries = result._unsafeUnwrap();
      expect(entries).toHaveLength(2);
      expect(entries[0]?.entityId).toBe('hubspot:contact:1');
      expect(entries[0]?.accessCount).toBe(42);
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('query failed'));
      const result = await analyzer.analyzeQueryPatterns('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('optimizeVectorIndex', () => {
    it('recommends ivfflat_lists tuning for large entity sets', async () => {
      sql.mockResolvedValueOnce([{ entity_count: 150000 }]);
      sql.mockResolvedValueOnce([{ avg_vs_ms: 100, p95_vs_ms: 200 }]);
      const result = await analyzer.optimizeVectorIndex('ws-1');
      expect(result.isOk()).toBe(true);
      const recs = result._unsafeUnwrap();
      expect(recs.some((r) => r.type === 'ivfflat_lists')).toBe(true);
      expect(recs.find((r) => r.type === 'ivfflat_lists')?.priority).toBe('high');
    });

    it('recommends ann_tuning when p95 vector search exceeds 500ms', async () => {
      sql.mockResolvedValueOnce([{ entity_count: 5000 }]);
      sql.mockResolvedValueOnce([{ avg_vs_ms: 600, p95_vs_ms: 1200 }]);
      const result = await analyzer.optimizeVectorIndex('ws-1');
      expect(result.isOk()).toBe(true);
      const recs = result._unsafeUnwrap();
      expect(recs.some((r) => r.type === 'ann_tuning')).toBe(true);
    });

    it('returns a healthy message when no issues found', async () => {
      sql.mockResolvedValueOnce([{ entity_count: 500 }]);
      sql.mockResolvedValueOnce([{ avg_vs_ms: 50, p95_vs_ms: 90 }]);
      const result = await analyzer.optimizeVectorIndex('ws-1');
      expect(result.isOk()).toBe(true);
      const recs = result._unsafeUnwrap();
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0]?.estimatedImpact).toBe('None');
    });

    it('recommends partial_index for mid-size datasets', async () => {
      sql.mockResolvedValueOnce([{ entity_count: 50000 }]);
      sql.mockResolvedValueOnce([{ avg_vs_ms: 100, p95_vs_ms: 300 }]);
      const result = await analyzer.optimizeVectorIndex('ws-1');
      expect(result.isOk()).toBe(true);
      const recs = result._unsafeUnwrap();
      expect(recs.some((r) => r.type === 'partial_index')).toBe(true);
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('stats query failed'));
      const result = await analyzer.optimizeVectorIndex('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });
});
