/**
 * IndexOptimizer tests using synthetic data with mocked SQL (no real DB required).
 */
import { describe, it, expect, vi } from 'vitest';
import { IndexOptimizer } from '../index-optimizer.js';

const WORKSPACE = 'ws-test';

function makeAuditRows(count: number, cacheHitRate = 0.4) {
  return Array.from({ length: count }, (_, i) => ({
    tool_name: 'query-context',
    query: `query ${i % 20}`,
    token_estimate: 500,
    cache_hit: i < count * cacheHitRate,
    tokens_saved_caching: i < count * cacheHitRate ? 200 : 0,
    tokens_saved_compression: 50,
    timestamp: new Date(),
  }));
}

function makeIndexRows(types: string[], countPerType = 1000) {
  return types.map(t => ({
    entity_type: t,
    entity_count: String(countPerType),
    total_bytes: String(countPerType * 512),
  }));
}

function makeSql(auditRows: unknown[], indexRows: unknown[]) {
  let call = 0;
  const results = [auditRows, indexRows];
  return vi.fn((strings: TemplateStringsArray) => {
    const s = strings.join('');
    if (!s.includes('SELECT')) return { strings };
    return Promise.resolve(results[call++] ?? []);
  }) as unknown as Parameters<typeof IndexOptimizer>[0];
}

describe('IndexOptimizer.analyze()', () => {
  it('returns a well-structured report', async () => {
    const sql = makeSql(makeAuditRows(200, 0.5), makeIndexRows(['contact', 'deal'], 5000));
    const optimizer = new IndexOptimizer(sql);
    const result = await optimizer.analyze(WORKSPACE);
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report.workspaceId).toBe(WORKSPACE);
    expect(report.totalEntities).toBe(10000);
    expect(Array.isArray(report.suggestions)).toBe(true);
    expect(Array.isArray(report.hotEntities)).toBe(true);
    expect(report.cacheHitRatePct).toBeGreaterThanOrEqual(0);
    expect(report.cacheHitRatePct).toBeLessThanOrEqual(100);
  });

  it('reports correct cache hit rate', async () => {
    const sql = makeSql(makeAuditRows(100, 0.6), makeIndexRows(['contact']));
    const result = await new IndexOptimizer(sql).analyze(WORKSPACE);
    const report = result._unsafeUnwrap();
    expect(report.cacheHitRatePct).toBe(60);
  });

  it('suggests low-cache-hit-rate fix when cache hit rate < 30%', async () => {
    const sql = makeSql(makeAuditRows(200, 0.1), makeIndexRows(['contact']));
    const result = await new IndexOptimizer(sql).analyze(WORKSPACE);
    const report = result._unsafeUnwrap();
    const ids = report.suggestions.map(s => s.id);
    expect(ids).toContain('low-cache-hit-rate');
  });

  it('marks low cache hit rate as critical when < 10%', async () => {
    const sql = makeSql(makeAuditRows(200, 0.05), makeIndexRows(['contact']));
    const result = await new IndexOptimizer(sql).analyze(WORKSPACE);
    const report = result._unsafeUnwrap();
    const suggestion = report.suggestions.find(s => s.id === 'low-cache-hit-rate');
    expect(suggestion?.severity).toBe('critical');
  });

  it('suggests large-index optimization for 1M+ entities', async () => {
    const sql = makeSql(makeAuditRows(10), makeIndexRows(['contact', 'deal'], 600_000));
    const result = await new IndexOptimizer(sql).analyze(WORKSPACE);
    const report = result._unsafeUnwrap();
    const ids = report.suggestions.map(s => s.id);
    expect(ids).toContain('large-index');
  });

  it('suggests partial index for type with > 100K entries', async () => {
    const sql = makeSql(makeAuditRows(10), makeIndexRows(['contact'], 150_000));
    const result = await new IndexOptimizer(sql).analyze(WORKSPACE);
    const report = result._unsafeUnwrap();
    const ids = report.suggestions.map(s => s.id);
    expect(ids).toContain('partial-index-contact');
  });

  it('returns err when SQL throws', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('db down'))) as unknown as Parameters<typeof IndexOptimizer>[0];
    const result = await new IndexOptimizer(sql).analyze(WORKSPACE);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('db down');
  });

  it('handles zero queries gracefully', async () => {
    const sql = makeSql([], makeIndexRows(['contact']));
    const result = await new IndexOptimizer(sql).analyze(WORKSPACE);
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report.cacheHitRatePct).toBe(0);
    const ids = report.suggestions.map(s => s.id);
    expect(ids).toContain('no-recent-queries');
  });

  it('hotEntities are sorted by entity count descending', async () => {
    const sql = makeSql(
      makeAuditRows(50),
      [
        { entity_type: 'deal', entity_count: '500', total_bytes: '256000' },
        { entity_type: 'contact', entity_count: '2000', total_bytes: '1024000' },
      ],
    );
    const result = await new IndexOptimizer(sql).analyze(WORKSPACE);
    const report = result._unsafeUnwrap();
    expect(report.hotEntities[0]?.entityType).toBe('contact');
    expect(report.hotEntities[1]?.entityType).toBe('deal');
  });
});
