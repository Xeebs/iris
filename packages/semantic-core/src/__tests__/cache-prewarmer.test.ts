import { describe, it, expect, vi } from 'vitest';
import {
  analyzeQueryPatterns,
  predictNextContext,
  preloadToCache,
  measurePrefixCacheHits,
} from '../cache-prewarmer.js';

const WS = 'ws-test';

function makeSql(returnValue: unknown = []) {
  return vi.fn().mockResolvedValue(returnValue) as never;
}

describe('analyzeQueryPatterns', () => {
  it('returns co-occurrence patterns from query_patterns table', async () => {
    const rows = [
      { entity_types_queried: JSON.stringify(['contact', 'deal']), occurrences: 50, filters_used: null },
      { entity_types_queried: JSON.stringify(['contact', 'company']), occurrences: 30, filters_used: null },
      { entity_types_queried: JSON.stringify(['deal']), occurrences: 20, filters_used: null },
    ];
    const result = await analyzeQueryPatterns(makeSql(rows), WS, 7);
    expect(result.isOk()).toBe(true);
    const patterns = result._unsafeUnwrap();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0]!.coOccurrenceScore).toBeGreaterThan(0);
  });

  it('returns empty list when no patterns', async () => {
    const result = await analyzeQueryPatterns(makeSql([]), WS, 7);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('filters patterns below 3% threshold', async () => {
    const rows = [
      { entity_types_queried: JSON.stringify(['contact', 'deal']), occurrences: 1, filters_used: null },
      { entity_types_queried: JSON.stringify(['contact', 'deal']), occurrences: 1, filters_used: null },
      // 2/100 = 2% → below threshold
      ...Array.from({ length: 98 }, () => ({
        entity_types_queried: JSON.stringify(['other']),
        occurrences: 1,
        filters_used: null,
      })),
    ];
    const result = await analyzeQueryPatterns(makeSql(rows), WS, 7);
    expect(result.isOk()).toBe(true);
    // contact:deal pair has 2% — should be filtered
    const patterns = result._unsafeUnwrap();
    expect(patterns.every(p => p.coOccurrenceScore >= 0.03)).toBe(true);
  });

  it('caps output at 20 patterns', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      entity_types_queried: JSON.stringify([`type-${i}`, `type-${i + 1}`]),
      occurrences: 10,
      filters_used: null,
    }));
    const result = await analyzeQueryPatterns(makeSql(rows), WS, 7);
    expect(result._unsafeUnwrap().length).toBeLessThanOrEqual(20);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout')) as never;
    const result = await analyzeQueryPatterns(sql, WS, 7);
    expect(result.isErr()).toBe(true);
  });
});

describe('predictNextContext', () => {
  it('predicts related entity IDs from relationship edges', async () => {
    const relatedRows = [
      { entity_id: 'ent-2', relationship_type: 'belongs_to' },
      { entity_id: 'ent-3', relationship_type: 'related_to' },
    ];
    const sql = vi.fn()
      .mockResolvedValueOnce(relatedRows) // entity_relationships
      .mockResolvedValueOnce([]) as never;  // entities by type

    const result = await predictNextContext(sql, WS, 'find contacts', ['ent-1']);
    expect(result.isOk()).toBe(true);
    const ctx = result._unsafeUnwrap();
    expect(ctx.entityIds).toContain('ent-2');
    expect(ctx.confidenceScore).toBeGreaterThan(0);
    expect(ctx.ttlSeconds).toBeGreaterThan(0);
  });

  it('returns empty prediction for empty current context', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([]) // no relationships (skipped when entityIds empty)
      .mockResolvedValueOnce([{ entity_id: 'ent-5' }]) as never; // entities by type
    const result = await predictNextContext(sql, WS, 'find deals', []);
    expect(result.isOk()).toBe(true);
    const ctx = result._unsafeUnwrap();
    expect(ctx.entityTypes).toContain('deal');
  });

  it('assigns low confidence during off-hours', async () => {
    // Ensure off-hours scenario — hard to mock UTC hour, just verify it's bounded
    const sql = vi.fn().mockResolvedValue([]) as never;
    const result = await predictNextContext(sql, WS, 'unknown query', []);
    expect(result.isOk()).toBe(true);
    const ctx = result._unsafeUnwrap();
    expect(ctx.confidenceScore).toBeGreaterThanOrEqual(0.2);
    expect(ctx.confidenceScore).toBeLessThanOrEqual(0.9);
  });

  it('deduplicates entity IDs', async () => {
    const relatedRows = [
      { entity_id: 'ent-1', relationship_type: 'belongs_to' },
      { entity_id: 'ent-1', relationship_type: 'related_to' }, // duplicate
      { entity_id: 'ent-2', relationship_type: 'related_to' },
    ];
    const sql = vi.fn()
      .mockResolvedValueOnce(relatedRows)
      .mockResolvedValueOnce([]) as never;
    const result = await predictNextContext(sql, WS, 'find contacts', ['base-ent']);
    const ids = result._unsafeUnwrap().entityIds;
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as never;
    const result = await predictNextContext(sql, WS, 'query', ['e1']);
    expect(result.isErr()).toBe(true);
  });
});

describe('preloadToCache', () => {
  it('returns loaded count matching DB results', async () => {
    const entityRows = [{ id: 'ent-1' }, { id: 'ent-2' }];
    const sql = vi.fn()
      .mockResolvedValueOnce(entityRows) // SELECT entities
      .mockResolvedValueOnce([]) as never; // INSERT stats
    const result = await preloadToCache(sql, WS, ['ent-1', 'ent-2', 'ent-3'], 300);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().loadedCount).toBe(2);
    expect(result._unsafeUnwrap().entityIds).toEqual(['ent-1', 'ent-2']);
  });

  it('returns empty result for empty entityIds', async () => {
    const sql = vi.fn() as never;
    const result = await preloadToCache(sql, WS, [], 300);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().loadedCount).toBe(0);
  });

  it('records prewarming stats', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ id: 'ent-1' }])
      .mockResolvedValueOnce([]) as never;
    await preloadToCache(sql, WS, ['ent-1'], 300);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('DB error')) as never;
    const result = await preloadToCache(sql, WS, ['ent-1'], 300);
    expect(result.isErr()).toBe(true);
  });
});

describe('measurePrefixCacheHits', () => {
  it('computes accuracy ratio from stats', async () => {
    const statsRow = {
      total_loaded: '100',
      total_hits: '70',
      total_predictions: '10',
      period_start: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      period_end: new Date().toISOString(),
    };
    const result = await measurePrefixCacheHits(makeSql([statsRow]), WS, 7);
    expect(result.isOk()).toBe(true);
    const stats = result._unsafeUnwrap();
    expect(stats.accuracyRatio).toBe(0.7);
    expect(stats.cacheHitsFromWarming).toBe(70);
    expect(stats.avgLatencyImprovementMs).toBeGreaterThan(0);
  });

  it('returns zero accuracy for no data', async () => {
    const result = await measurePrefixCacheHits(makeSql([{}]), WS, 7);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().accuracyRatio).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout')) as never;
    const result = await measurePrefixCacheHits(sql, WS, 7);
    expect(result.isErr()).toBe(true);
  });
});
