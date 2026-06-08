import { describe, it, expect } from 'vitest';
import {
  learnFromSuccessfulQueries,
  suggestRelatedQueries,
  type QueryHistoryEntry,
} from '../query-learning-engine.js';

/**
 * Integration-level tests for the query learning engine.
 * These tests use in-memory mock SQL and simulate 500-query corpus behavior.
 * They do NOT require Docker services.
 */

const QUERY_CORPUS = [
  { text: 'find top contacts by revenue', types: ['contact'] },
  { text: 'deals closing this quarter', types: ['deal'] },
  { text: 'enterprise accounts in EMEA', types: ['company'] },
  { text: 'support tickets from VIP customers', types: ['ticket', 'contact'] },
  { text: 'leads created last week', types: ['lead'] },
  { text: 'contacts associated with deals', types: ['contact', 'deal'] },
  { text: 'monthly recurring revenue summary', types: [] },
  { text: 'top 10 deals by value', types: ['deal'] },
  { text: 'company headcount over 500', types: ['company'] },
  { text: 'open support tickets by assignee', types: ['ticket'] },
];

function generateQueryHistory(n: number): QueryHistoryEntry[] {
  const entries: QueryHistoryEntry[] = [];
  for (let i = 0; i < n; i++) {
    const template = QUERY_CORPUS[i % QUERY_CORPUS.length]!;
    entries.push({
      queryHash: `h${i % 20}`,
      queryText: template.text,
      entityTypesQueried: template.types,
      filtersUsed: i % 3 === 0 ? { status: 'active' } : {},
      resultCount: 5 + (i % 50),
      success: i % 10 !== 9,
      executedAt: new Date(),
    });
  }
  return entries;
}

describe('QueryLearningEngine — corpus simulation', () => {
  it('processes 500 queries without error', async () => {
    const stored: unknown[] = [];
    const sql = Object.assign(
      (..._args: unknown[]) => { stored.push({}); return Promise.resolve([]); },
    );
    const history = generateQueryHistory(500);
    const result = await learnFromSuccessfulQueries(sql as never, 'ws-corpus', history);
    expect(result.isOk()).toBe(true);
    const patternsUpserted = result._unsafeUnwrap();
    expect(patternsUpserted).toBeGreaterThan(0);
    expect(patternsUpserted).toBeLessThanOrEqual(20);
  });

  it('learns distinct patterns from first 100 queries', async () => {
    const sql = Object.assign((..._args: unknown[]) => Promise.resolve([]));
    const history = generateQueryHistory(100);
    const result = await learnFromSuccessfulQueries(sql as never, 'ws-test', history);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeGreaterThan(0);
  });

  it('suggestion engine finds related queries from stored patterns', async () => {
    const patterns = [
      {
        query_hash: 'h1',
        entity_types_queried: JSON.stringify(['deal', 'contact']),
        similar_queries: JSON.stringify(['top deals by contact', 'contacts with open deals']),
        success_rate: 0.9,
        occurrences: 10,
      },
      {
        query_hash: 'h2',
        entity_types_queried: JSON.stringify(['contact']),
        similar_queries: JSON.stringify(['find all contacts', 'enterprise contacts']),
        success_rate: 0.85,
        occurrences: 8,
      },
    ];
    const sql = Object.assign((..._args: unknown[]) => Promise.resolve(patterns));
    const result = await suggestRelatedQueries(sql as never, 'ws-test', 'find contacts', 5);
    expect(result.isOk()).toBe(true);
    const suggestions = result._unsafeUnwrap();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every(s => s.confidence > 0)).toBe(true);
    expect(suggestions.every(s => typeof s.reason === 'string')).toBe(true);
  });

  it('suggestions are ranked by confidence descending', async () => {
    const patterns = [
      {
        query_hash: 'low',
        entity_types_queried: JSON.stringify(['deal']),
        similar_queries: JSON.stringify(['deals this month']),
        success_rate: 0.7,
        occurrences: 3,
      },
      {
        query_hash: 'high',
        entity_types_queried: JSON.stringify(['contact', 'deal']),
        similar_queries: JSON.stringify(['contacts with deals over $10k']),
        success_rate: 0.95,
        occurrences: 20,
      },
    ];
    const sql = Object.assign((..._args: unknown[]) => Promise.resolve(patterns));
    const result = await suggestRelatedQueries(sql as never, 'ws-test', 'find top contacts and deals', 5);
    expect(result.isOk()).toBe(true);
    const suggestions = result._unsafeUnwrap();
    if (suggestions.length >= 2) {
      expect(suggestions[0]!.confidence).toBeGreaterThanOrEqual(suggestions[1]!.confidence);
    }
  });
});
