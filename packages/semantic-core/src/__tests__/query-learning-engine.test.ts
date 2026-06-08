import { describe, it, expect, vi } from 'vitest';
import {
  learnFromSuccessfulQueries,
  suggestRelatedQueries,
  suggestMissingContext,
  recommendIndexExpansion,
  hashQuery,
  type QueryHistoryEntry,
} from '../query-learning-engine.js';

const NOW = new Date('2026-06-08T00:00:00Z');

function makeEntry(overrides: Partial<QueryHistoryEntry> = {}): QueryHistoryEntry {
  return {
    queryHash: 'abc12345',
    queryText: 'find top contacts',
    entityTypesQueried: ['contact'],
    filtersUsed: {},
    resultCount: 10,
    success: true,
    executedAt: NOW,
    ...overrides,
  };
}

describe('learnFromSuccessfulQueries', () => {
  it('returns 0 when no successful entries', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await learnFromSuccessfulQueries(sql as never, 'ws-1', [
      makeEntry({ success: false }),
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(0);
    expect(sql).not.toHaveBeenCalled();
  });

  it('upserts one pattern per unique queryHash', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const entries = [
      makeEntry({ queryHash: 'h1', queryText: 'top deals', entityTypesQueried: ['deal'] }),
      makeEntry({ queryHash: 'h1', queryText: 'top deals', entityTypesQueried: ['deal'] }),
      makeEntry({ queryHash: 'h2', queryText: 'contacts by region', entityTypesQueried: ['contact'] }),
    ];
    const result = await learnFromSuccessfulQueries(sql as never, 'ws-1', entries);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(2);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('extracts entity types from query text when entityTypesQueried is empty', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const entry = makeEntry({ entityTypesQueried: [], queryText: 'show all deals this quarter' });
    const result = await learnFromSuccessfulQueries(sql as never, 'ws-1', [entry]);
    expect(result.isOk()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('constraint'));
    const result = await learnFromSuccessfulQueries(sql as never, 'ws-1', [makeEntry()]);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('constraint');
  });
});

describe('suggestRelatedQueries', () => {
  it('returns suggestions matching current entity types', async () => {
    const rows = [
      {
        query_hash: 'h99',
        entity_types_queried: JSON.stringify(['contact', 'deal']),
        similar_queries: JSON.stringify(['top deals by contact', 'contacts with deals']),
        success_rate: 0.9,
        occurrences: 5,
      },
    ];
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await suggestRelatedQueries(sql as never, 'ws-1', 'find contacts', 5);
    expect(result.isOk()).toBe(true);
    const suggestions = result._unsafeUnwrap();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.confidence).toBeGreaterThan(0);
  });

  it('excludes the current query itself', async () => {
    const currentQuery = 'find top contacts';
    const currentHash = hashQuery(currentQuery);
    const rows = [
      {
        query_hash: currentHash,
        entity_types_queried: JSON.stringify(['contact']),
        similar_queries: JSON.stringify([currentQuery]),
        success_rate: 0.9,
        occurrences: 3,
      },
    ];
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await suggestRelatedQueries(sql as never, 'ws-1', currentQuery, 5);
    expect(result.isOk()).toBe(true);
    const suggestions = result._unsafeUnwrap();
    expect(suggestions.every(s => s.queryHash !== currentHash)).toBe(true);
  });

  it('returns empty list when no patterns exist', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await suggestRelatedQueries(sql as never, 'ws-empty', 'find contacts', 5);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await suggestRelatedQueries(sql as never, 'ws-1', 'find contacts', 5);
    expect(result.isErr()).toBe(true);
  });
});

describe('suggestMissingContext', () => {
  it('returns attributes not present in current results', async () => {
    const rows = [
      { entity_type: 'contact', attribute: 'phone', suggestion_confidence: 0.8, use_case: 'Follow-up calls' },
      { entity_type: 'contact', attribute: 'email', suggestion_confidence: 0.95, use_case: 'Email outreach' },
    ];
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await suggestMissingContext(sql as never, 'ws-1', 'find contacts', ['name', 'company']);
    expect(result.isOk()).toBe(true);
    const candidates = result._unsafeUnwrap();
    expect(candidates.some(c => c.attribute === 'phone')).toBe(true);
    expect(candidates.some(c => c.attribute === 'email')).toBe(true);
  });

  it('excludes attributes already present in results', async () => {
    const rows = [
      { entity_type: 'contact', attribute: 'email', suggestion_confidence: 0.9, use_case: 'Email outreach' },
    ];
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await suggestMissingContext(sql as never, 'ws-1', 'find contacts', ['email']);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().some(c => c.attribute === 'email')).toBe(false);
  });

  it('returns empty when no entity type recognized', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await suggestMissingContext(sql as never, 'ws-1', 'unknown query type', []);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
    expect(sql).not.toHaveBeenCalled();
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await suggestMissingContext(sql as never, 'ws-1', 'find deals', []);
    expect(result.isErr()).toBe(true);
  });
});

describe('recommendIndexExpansion', () => {
  it('recommends connectors for high-frequency entity types', async () => {
    const rows = [
      { entity_types_queried: JSON.stringify(['ticket']), total_occurrences: '50' },
      { entity_types_queried: JSON.stringify(['deal', 'contact']), total_occurrences: '30' },
    ];
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await recommendIndexExpansion(sql as never, 'ws-1');
    expect(result.isOk()).toBe(true);
    const recs = result._unsafeUnwrap();
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every(r => r.estimatedQueryCoverage > 0)).toBe(true);
  });

  it('returns empty when no query patterns exist', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await recommendIndexExpansion(sql as never, 'ws-empty');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('caps recommendations at 5', async () => {
    const rows = ['ticket', 'deal', 'lead', 'company', 'activity', 'contact'].map(t => ({
      entity_types_queried: JSON.stringify([t]),
      total_occurrences: '100',
    }));
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await recommendIndexExpansion(sql as never, 'ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().length).toBeLessThanOrEqual(5);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await recommendIndexExpansion(sql as never, 'ws-1');
    expect(result.isErr()).toBe(true);
  });
});
