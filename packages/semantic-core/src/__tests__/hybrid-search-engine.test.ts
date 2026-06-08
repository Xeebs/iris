import { describe, it, expect, vi } from 'vitest';
import {
  parseQuerySyntax,
  levenshteinDistance,
  applyRRF,
  highlightTerms,
  HybridSearchEngine,
} from '../hybrid-search-engine.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

// ─── Pure function tests ─────────────────────────────────────────────────────

describe('parseQuerySyntax', () => {
  it('extracts quoted phrases', () => {
    const r = parseQuerySyntax('"acme corp" sales');
    expect(r.phrases).toEqual(['acme corp']);
    expect(r.terms).toContain('sales');
  });

  it('extracts field:value pairs', () => {
    const r = parseQuerySyntax('status:active owner:john');
    expect(r.fieldFilters).toEqual({ status: 'active', owner: 'john' });
  });

  it('strips boolean operators', () => {
    const r = parseQuerySyntax('revenue AND growth NOT expense');
    expect(r.terms).toContain('revenue');
    expect(r.terms).toContain('growth');
    expect(r.terms).not.toContain('AND');
    expect(r.terms).not.toContain('NOT');
  });

  it('handles plain text without syntax', () => {
    const r = parseQuerySyntax('open deals');
    expect(r.terms).toEqual(['open', 'deals']);
    expect(r.phrases).toEqual([]);
    expect(r.fieldFilters).toEqual({});
  });

  it('normalizes combined phrase + terms', () => {
    const r = parseQuerySyntax('"big deal" amount type:contract');
    expect(r.phrases).toEqual(['big deal']);
    expect(r.terms).toContain('amount');
    expect(r.fieldFilters['type']).toBe('contract');
  });

  it('returns raw query as normalized when nothing parses', () => {
    const r = parseQuerySyntax('x');
    expect(r.normalized).toBe('x');
  });

  it('ignores empty terms from extra whitespace', () => {
    const r = parseQuerySyntax('  hello   world  ');
    expect(r.terms).toEqual(['hello', 'world']);
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns string length when other is empty', () => {
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('computes single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('computes insertion distance', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('computes deletion distance', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('handles longer strings', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('applyRRF', () => {
  it('assigns higher score to top-ranked items', () => {
    const bm25 = ['a', 'b', 'c'];
    const sem = ['a', 'c', 'b'];
    const scores = applyRRF(bm25, sem);
    expect(scores.get('a')! > scores.get('b')!).toBe(true);
    expect(scores.get('a')! > scores.get('c')!).toBe(true);
  });

  it('includes items appearing in only one list', () => {
    const scores = applyRRF(['x'], ['y']);
    expect(scores.has('x')).toBe(true);
    expect(scores.has('y')).toBe(true);
  });

  it('respects weights — semantic item beats BM25 item when semW is dominant', () => {
    // a is in semantic only, b is in BM25 only, both at rank 0
    const highSem = applyRRF(['b'], ['a'], 60, 0.1, 0.9);
    expect(highSem.get('a')! > highSem.get('b')!).toBe(true);

    const highBm25 = applyRRF(['b'], ['a'], 60, 0.9, 0.1);
    expect(highBm25.get('b')! > highBm25.get('a')!).toBe(true);
  });

  it('returns empty map for empty inputs', () => {
    expect(applyRRF([], []).size).toBe(0);
  });

  it('handles duplicate IDs across lists (same id in both)', () => {
    const scores = applyRRF(['id1'], ['id1']);
    expect(scores.get('id1')).toBeDefined();
    expect(scores.get('id1')! > 0.4 / 61).toBe(true);
  });

  it('uses default k=60', () => {
    const scores = applyRRF(['a'], ['a']);
    const expected = 0.4 / (60 + 1) + 0.6 / (60 + 1);
    expect(scores.get('a')).toBeCloseTo(expected, 10);
  });
});

describe('highlightTerms', () => {
  it('wraps matched terms in mark tags', () => {
    expect(highlightTerms('hello world', ['world'])).toBe('hello <mark>world</mark>');
  });

  it('is case-insensitive', () => {
    expect(highlightTerms('Hello World', ['hello'])).toBe('<mark>Hello</mark> World');
  });

  it('returns text unchanged when no terms', () => {
    expect(highlightTerms('no match', [])).toBe('no match');
  });

  it('highlights multiple terms', () => {
    const result = highlightTerms('foo bar baz', ['foo', 'baz']);
    expect(result).toContain('<mark>foo</mark>');
    expect(result).toContain('<mark>baz</mark>');
  });

  it('escapes regex special chars in terms', () => {
    expect(() => highlightTerms('test.value', ['test.value'])).not.toThrow();
    expect(highlightTerms('test.value', ['test.value'])).toContain('<mark>');
  });
});

// ─── HybridSearchEngine tests ────────────────────────────────────────────────

type Responses = Array<unknown[]>;

function makeSql(...responses: Responses) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? [];
    return Promise.resolve(r);
  });
  // Allow chaining .catch on the returned promise
  return fn as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>;
}

const baseRequest = {
  workspaceId: 'ws-1',
  query: 'open deals',
  filters: {},
  limit: 20,
  offset: 0,
  sortBy: 'relevance' as const,
  includeSuggestions: false,
  explainScoring: false,
  hybridWeights: { bm25: 0.4, semantic: 0.6 },
};

const entityRow = {
  id: 'e-1',
  entity_type: 'deal',
  label: 'Big Deal',
  attributes: { amount: 50000 },
  source_connector_id: 'hubspot',
  last_modified: '2026-05-01T00:00:00Z',
};

describe('HybridSearchEngine.search', () => {
  it('returns empty results when both BM25 and semantic return nothing', async () => {
    const sql = makeSql([], []);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search(baseRequest);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results).toHaveLength(0);
    expect(result._unsafeUnwrap().total).toBe(0);
    expect(result._unsafeUnwrap().hasMore).toBe(false);
  });

  it('merges BM25 and semantic results via RRF', async () => {
    const bm25Rows = [{ id: 'e-1', score: '0.8' }];
    const semRows = [{ id: 'e-1', distance: '0.1' }];
    const entityRows = [entityRow];
    const sql = makeSql(bm25Rows, semRows, entityRows);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search(baseRequest);
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]?.id).toBe('e-1');
  });

  it('applies offset and limit correctly', async () => {
    const bm25Rows = [
      { id: 'e-1', score: '0.9' },
      { id: 'e-2', score: '0.8' },
      { id: 'e-3', score: '0.7' },
    ];
    const semRows = bm25Rows;
    const entityRows = [
      { ...entityRow, id: 'e-2', label: 'Deal 2' },
      { ...entityRow, id: 'e-3', label: 'Deal 3' },
    ];
    const sql = makeSql(bm25Rows, semRows, entityRows);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search({ ...baseRequest, offset: 1, limit: 2 });
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.results.length).toBeLessThanOrEqual(2);
  });

  it('includes score explanation when explainScoring=true', async () => {
    const bm25Rows = [{ id: 'e-1', score: '0.8' }];
    const semRows = [{ id: 'e-1', distance: '0.1' }];
    const entityRows = [entityRow];
    const sql = makeSql(bm25Rows, semRows, entityRows);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search({ ...baseRequest, explainScoring: true });
    const item = result._unsafeUnwrap().results[0];
    expect(item?.explanation).toBeDefined();
    expect(item?.explanation?.rrfScore).toBeGreaterThan(0);
    expect(item?.explanation?.bm25Rank).toBe(1);
  });

  it('returns suggestions when includeSuggestions=true', async () => {
    const bm25Rows: unknown[] = [];
    const semRows: unknown[] = [];
    const suggRows = [{ label: 'Open Pipeline', entity_type: 'deal' }];
    const sql = makeSql(bm25Rows, semRows, suggRows);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search({ ...baseRequest, includeSuggestions: true });
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.suggestions).toBeDefined();
  });

  it('highlights label in results', async () => {
    const bm25Rows = [{ id: 'e-1', score: '0.8' }];
    const semRows: unknown[] = [];
    const entityRows = [entityRow];
    const sql = makeSql(bm25Rows, semRows, entityRows);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search({ ...baseRequest, query: 'Big' });
    const item = result._unsafeUnwrap().results[0];
    expect(item?.highlightedLabel).toContain('<mark>');
  });

  it('sorts by label_asc when sortBy=label_asc', async () => {
    const rows = [
      { id: 'e-1', score: '0.9' },
      { id: 'e-2', score: '0.8' },
    ];
    const entityRows = [
      { ...entityRow, id: 'e-1', label: 'Zebra' },
      { ...entityRow, id: 'e-2', label: 'Apple' },
    ];
    const sql = makeSql(rows, rows, entityRows);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search({ ...baseRequest, sortBy: 'label_asc' });
    const labels = result._unsafeUnwrap().results.map((r) => r.label);
    expect(labels[0]).toBe('Apple');
    expect(labels[1]).toBe('Zebra');
  });

  it('sorts by newest when sortBy=newest', async () => {
    const rows = [
      { id: 'e-1', score: '0.9' },
      { id: 'e-2', score: '0.8' },
    ];
    const entityRows = [
      { ...entityRow, id: 'e-1', last_modified: '2025-01-01T00:00:00Z' },
      { ...entityRow, id: 'e-2', last_modified: '2026-01-01T00:00:00Z' },
    ];
    const sql = makeSql(rows, rows, entityRows);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search({ ...baseRequest, sortBy: 'newest' });
    const ids = result._unsafeUnwrap().results.map((r) => r.id);
    expect(ids[0]).toBe('e-2');
  });

  it('returns ok with empty results when all sql calls reject (caught internally)', async () => {
    // BM25 and semantic queries both have .catch(() => []) so DB errors yield empty lists
    const fn = vi.fn().mockRejectedValue(new Error('DB crash'));
    const engine = new HybridSearchEngine(fn as unknown as Parameters<typeof HybridSearchEngine.prototype.search>[0] extends never ? never : never);
    const result = await engine.search(baseRequest);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results).toHaveLength(0);
  });

  it('hasMore is true when results exceed page', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `e-${i}`, score: '0.5' }));
    const entityRows = rows.map((r) => ({ ...entityRow, id: r.id, label: `Deal ${r.id}` }));
    const sql = makeSql(rows, rows, entityRows);
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search({ ...baseRequest, limit: 3 });
    expect(result._unsafeUnwrap().hasMore).toBe(true);
  });
});
