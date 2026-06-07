import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseAdvancedQuery,
  applyFilters,
  executeAggregation,
  formatAggregationResult,
  chainQueries,
  type FilterCondition,
  type AggregationSpec,
} from '../advanced-query-engine.js';
import type { SemanticEntity } from '@iris/connector-sdk';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../retrieval.js', () => ({
  retrieveContext: vi.fn(),
}));

import { retrieveContext } from '../retrieval.js';

const mockRetrieveContext = vi.mocked(retrieveContext);

function makeEntity(overrides: Partial<SemanticEntity> & { attributes?: Record<string, unknown> }): SemanticEntity {
  return {
    id: 'e-1',
    type: 'contact',
    label: 'Test Entity',
    attributes: {},
    relationships: [],
    lastModified: new Date().toISOString(),
    sourceId: 'e-1',
    ...overrides,
  };
}

// ── parseAdvancedQuery ──────────────────────────────────────────────────────

describe('parseAdvancedQuery', () => {
  it('parses entity type alias with WHERE clause', () => {
    const r = parseAdvancedQuery("contacts where industry='SaaS'");
    expect(r.entityType).toBe('contact');
    expect(r.filters).toHaveLength(1);
    expect(r.filters[0]).toMatchObject({ field: 'industry', op: '=', value: 'SaaS' });
  });

  it('parses plural entity type (companies → company)', () => {
    const r = parseAdvancedQuery("companies where size>100");
    expect(r.entityType).toBe('company');
  });

  it('parses numeric value with k suffix (100k → 100000)', () => {
    const r = parseAdvancedQuery("contacts where ARR>100k");
    expect(r.filters[0]).toMatchObject({ field: 'ARR', op: '>', value: 100_000 });
  });

  it('parses numeric value with m suffix (5m → 5000000)', () => {
    const r = parseAdvancedQuery("deals where revenue>=5m");
    expect(r.filters[0]).toMatchObject({ field: 'revenue', op: '>=', value: 5_000_000 });
  });

  it('parses multiple AND conditions', () => {
    const r = parseAdvancedQuery("contacts where industry='SaaS' and ARR>100k");
    expect(r.filters).toHaveLength(2);
  });

  it('parses != operator', () => {
    const r = parseAdvancedQuery("contacts where status!='closed'");
    expect(r.filters[0]).toMatchObject({ op: '!=', value: 'closed' });
  });

  it('parses <= operator', () => {
    const r = parseAdvancedQuery("deals where stage<=3");
    expect(r.filters[0]).toMatchObject({ op: '<=', value: 3 });
  });

  it('parses contains operator', () => {
    const r = parseAdvancedQuery("contacts where label contains 'Smith'");
    expect(r.filters[0]).toMatchObject({ op: 'contains', value: 'Smith' });
  });

  it('parses startsWith operator', () => {
    const r = parseAdvancedQuery("contacts where label startsWith 'John'");
    expect(r.filters[0]).toMatchObject({ op: 'startsWith', value: 'John' });
  });

  it('handles query with no WHERE clause', () => {
    const r = parseAdvancedQuery("find all open deals");
    expect(r.entityType).toBeUndefined();
    expect(r.filters).toHaveLength(0);
    expect(r.rawQuery).toBe('find all open deals');
  });

  it('handles plain entity type without conditions', () => {
    const r = parseAdvancedQuery("contacts");
    expect(r.entityType).toBe('contact');
    expect(r.filters).toHaveLength(0);
  });

  it('normalizes accounts alias to company', () => {
    const r = parseAdvancedQuery("accounts where region='EMEA'");
    expect(r.entityType).toBe('company');
  });
});

// ── applyFilters ────────────────────────────────────────────────────────────

describe('applyFilters', () => {
  const entities: SemanticEntity[] = [
    makeEntity({ id: '1', label: 'Acme Corp', attributes: { industry: 'SaaS', arr: 200_000, status: 'active' } }),
    makeEntity({ id: '2', label: 'Globex', attributes: { industry: 'Finance', arr: 50_000, status: 'active' } }),
    makeEntity({ id: '3', label: 'Initech', attributes: { industry: 'SaaS', arr: 80_000, status: 'churned' } }),
  ];

  it('returns all entities when no filters', () => {
    expect(applyFilters(entities, [])).toHaveLength(3);
  });

  it('filters by string equality', () => {
    const result = applyFilters(entities, [{ field: 'industry', op: '=', value: 'SaaS' }]);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(['1', '3']);
  });

  it('filters by numeric greater than', () => {
    const result = applyFilters(entities, [{ field: 'arr', op: '>', value: 100_000 }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('1');
  });

  it('filters by multiple AND conditions', () => {
    const result = applyFilters(entities, [
      { field: 'industry', op: '=', value: 'SaaS' },
      { field: 'arr', op: '>', value: 100_000 },
    ]);
    expect(result).toHaveLength(1);
  });

  it('filters by string inequality', () => {
    const result = applyFilters(entities, [{ field: 'status', op: '!=', value: 'churned' }]);
    expect(result).toHaveLength(2);
  });

  it('filters by label using contains', () => {
    const result = applyFilters(entities, [{ field: 'label', op: 'contains', value: 'Corp' }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('1');
  });

  it('filters by label using startsWith', () => {
    const result = applyFilters(entities, [{ field: 'label', op: 'startsWith', value: 'ac' }]);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when nothing matches', () => {
    const result = applyFilters(entities, [{ field: 'industry', op: '=', value: 'Healthcare' }]);
    expect(result).toHaveLength(0);
  });

  it('filters on missing field returns empty', () => {
    const result = applyFilters(entities, [{ field: 'nonexistent', op: '=', value: 'x' }]);
    expect(result).toHaveLength(0);
  });
});

// ── executeAggregation ──────────────────────────────────────────────────────

describe('executeAggregation', () => {
  const entities: SemanticEntity[] = [
    makeEntity({ id: '1', type: 'deal', attributes: { region: 'EMEA', revenue: 100_000, stage: 3 } }),
    makeEntity({ id: '2', type: 'deal', attributes: { region: 'EMEA', revenue: 200_000, stage: 4 } }),
    makeEntity({ id: '3', type: 'deal', attributes: { region: 'APAC', revenue: 50_000, stage: 2 } }),
    makeEntity({ id: '4', type: 'deal', attributes: { region: 'APAC', revenue: 150_000, stage: 5 } }),
  ];

  it('counts all entities', () => {
    const result = executeAggregation(entities, { op: 'count' });
    expect(result.total).toBe(4);
    expect(result.groups[0]?.value).toBe(4);
    expect(result.confidence).toBe(1);
  });

  it('counts by group', () => {
    const result = executeAggregation(entities, { op: 'count', groupBy: 'region' });
    expect(result.total).toBe(4);
    expect(result.groups).toHaveLength(2);
    const emea = result.groups.find((g) => g.key === 'EMEA');
    expect(emea?.value).toBe(2);
  });

  it('sums a numeric field', () => {
    const result = executeAggregation(entities, { op: 'sum', field: 'revenue' });
    expect(result.total).toBe(500_000);
  });

  it('sums by group', () => {
    const result = executeAggregation(entities, { op: 'sum', field: 'revenue', groupBy: 'region' });
    const emea = result.groups.find((g) => g.key === 'EMEA');
    expect(emea?.value).toBe(300_000);
    const apac = result.groups.find((g) => g.key === 'APAC');
    expect(apac?.value).toBe(200_000);
  });

  it('averages a numeric field', () => {
    const result = executeAggregation(entities, { op: 'avg', field: 'revenue' });
    expect(result.total).toBe(125_000);
  });

  it('finds minimum', () => {
    const result = executeAggregation(entities, { op: 'min', field: 'stage' });
    expect(result.total).toBe(2);
  });

  it('finds maximum', () => {
    const result = executeAggregation(entities, { op: 'max', field: 'revenue' });
    expect(result.total).toBe(200_000);
  });

  it('returns confidence=0 for empty entity set', () => {
    const result = executeAggregation([], { op: 'sum', field: 'revenue' });
    expect(result.total).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('partial confidence when some entities lack the field', () => {
    const mixed = [
      ...entities,
      makeEntity({ id: '5', type: 'deal', attributes: {} }),
    ];
    const result = executeAggregation(mixed, { op: 'sum', field: 'revenue' });
    expect(result.confidence).toBeLessThan(1);
  });
});

// ── formatAggregationResult ─────────────────────────────────────────────────

describe('formatAggregationResult', () => {
  it('formats a simple count result', () => {
    const result = executeAggregation(
      [makeEntity({ id: '1' }), makeEntity({ id: '2' })],
      { op: 'count' },
    );
    const text = formatAggregationResult(result, 'count all contacts');
    expect(text).toContain('COUNT');
    expect(text).toContain('2');
  });

  it('formats grouped sum result', () => {
    const entities: SemanticEntity[] = [
      makeEntity({ id: '1', attributes: { region: 'EMEA', revenue: 100 } }),
      makeEntity({ id: '2', attributes: { region: 'APAC', revenue: 200 } }),
    ];
    const result = executeAggregation(entities, { op: 'sum', field: 'revenue', groupBy: 'region' });
    const text = formatAggregationResult(result, 'sum revenue by region');
    expect(text).toContain('EMEA');
    expect(text).toContain('APAC');
  });

  it('shows "No numeric data" for empty result', () => {
    const result = executeAggregation([], { op: 'sum', field: 'revenue' });
    const text = formatAggregationResult(result, 'query');
    expect(text).toContain('No numeric data');
  });
});

// ── chainQueries ─────────────────────────────────────────────────────────────

describe('chainQueries', () => {
  const contactEntities: SemanticEntity[] = [
    makeEntity({ id: 'c1', type: 'contact', label: 'Alice' }),
    makeEntity({ id: 'c2', type: 'contact', label: 'Bob' }),
  ];

  const dealEntities: SemanticEntity[] = [
    makeEntity({ id: 'd1', type: 'deal', label: 'Big Deal' }),
    makeEntity({ id: 'd2', type: 'deal', label: 'Small Deal' }),
  ];

  beforeEach(() => {
    mockRetrieveContext.mockReset();
  });

  it('executes both queries and deduplicates combined results', async () => {
    mockRetrieveContext
      .mockResolvedValueOnce({ entities: contactEntities, scores: [], fromCache: false, queryEmbeddingMs: 0, vectorSearchMs: 0, graphExpansionMs: 0 })
      .mockResolvedValueOnce({ entities: dealEntities, scores: [], fromCache: false, queryEmbeddingMs: 0, vectorSearchMs: 0, graphExpansionMs: 0 });

    const result = await chainQueries('contacts', 'deals', {} as never, 'ws-1', 'key');
    expect(result.firstQueryEntities).toHaveLength(2);
    expect(result.chainedEntities).toHaveLength(2);
    expect(result.combined).toHaveLength(4);
  });

  it('deduplicates overlapping entities between queries', async () => {
    const sharedEntity = makeEntity({ id: 'c1', type: 'contact', label: 'Alice' });
    mockRetrieveContext
      .mockResolvedValueOnce({ entities: [sharedEntity], scores: [], fromCache: false, queryEmbeddingMs: 0, vectorSearchMs: 0, graphExpansionMs: 0 })
      .mockResolvedValueOnce({ entities: [sharedEntity, dealEntities[0]!], scores: [], fromCache: false, queryEmbeddingMs: 0, vectorSearchMs: 0, graphExpansionMs: 0 });

    const result = await chainQueries('contacts', 'related deals', {} as never, 'ws-1', 'key');
    expect(result.combined).toHaveLength(2);
  });

  it('enriches second query with context from first results', async () => {
    mockRetrieveContext
      .mockResolvedValueOnce({ entities: contactEntities, scores: [], fromCache: false, queryEmbeddingMs: 0, vectorSearchMs: 0, graphExpansionMs: 0 })
      .mockResolvedValueOnce({ entities: dealEntities, scores: [], fromCache: false, queryEmbeddingMs: 0, vectorSearchMs: 0, graphExpansionMs: 0 });

    await chainQueries('contacts', 'associated deals', {} as never, 'ws-1', 'key');

    const secondCall = mockRetrieveContext.mock.calls[1];
    expect(secondCall?.[0]).toContain('related to:');
    expect(secondCall?.[0]).toContain('Alice');
  });
});
