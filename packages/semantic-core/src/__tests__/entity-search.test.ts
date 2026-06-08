import { describe, it, expect, vi } from 'vitest';
import { EntitySearchEngine, parseFilterQuery, buildFilterClauses } from '../entity-search.js';

function makeSql(responseMap: unknown[][] = []) {
  let idx = 0;
  return vi.fn(async () => responseMap[idx++] ?? []);
}

describe('parseFilterQuery', () => {
  it('parses simple equality filter', () => {
    const filters = parseFilterQuery('type:contact');
    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual({ field: 'type', operator: 'eq', value: 'contact' });
  });

  it('parses multiple filters', () => {
    const filters = parseFilterQuery('type:contact status:active');
    expect(filters).toHaveLength(2);
    expect(filters[1]?.operator).toBe('eq');
    expect(filters[1]?.value).toBe('active');
  });

  it('parses glob-style startsWith', () => {
    const filters = parseFilterQuery('email:john*');
    expect(filters[0]?.operator).toBe('startsWith');
    expect(filters[0]?.value).toBe('john');
  });

  it('parses glob-style endsWith', () => {
    const filters = parseFilterQuery('email:*@acme.com');
    expect(filters[0]?.operator).toBe('endsWith');
    expect(filters[0]?.value).toBe('@acme.com');
  });

  it('parses contains with double wildcards', () => {
    const filters = parseFilterQuery('name:*John*');
    expect(filters[0]?.operator).toBe('contains');
    expect(filters[0]?.value).toBe('John');
  });

  it('parses tilde contains operator', () => {
    const filters = parseFilterQuery('name:~Johnson');
    expect(filters[0]?.operator).toBe('contains');
    expect(filters[0]?.value).toBe('Johnson');
  });

  it('parses greater-than numeric filter', () => {
    const filters = parseFilterQuery('amount:>5000');
    expect(filters[0]?.operator).toBe('gt');
    expect(filters[0]?.value).toBe('5000');
  });

  it('parses less-than numeric filter', () => {
    const filters = parseFilterQuery('score:<100');
    expect(filters[0]?.operator).toBe('lt');
    expect(filters[0]?.value).toBe('100');
  });

  it('ignores tokens without colon', () => {
    const filters = parseFilterQuery('justtext type:contact');
    expect(filters).toHaveLength(1);
  });

  it('ignores tokens with empty value', () => {
    const filters = parseFilterQuery('type:');
    expect(filters).toHaveLength(0);
  });

  it('handles empty string', () => {
    expect(parseFilterQuery('')).toHaveLength(0);
  });

  it('lowercases field names', () => {
    const filters = parseFilterQuery('TYPE:contact');
    expect(filters[0]?.field).toBe('type');
  });
});

describe('buildFilterClauses', () => {
  it('builds eq clause for core column', () => {
    const { clauses, params } = buildFilterClauses([{ field: 'type', operator: 'eq', value: 'contact' }]);
    expect(clauses[0]).toContain('entity_type =');
    expect(params).toEqual(['contact']);
  });

  it('maps connector field to connector_id', () => {
    const { clauses } = buildFilterClauses([{ field: 'connector', operator: 'eq', value: 'hubspot' }]);
    expect(clauses[0]).toContain('connector_id =');
  });

  it('uses JSONB operator for attribute field', () => {
    const { clauses } = buildFilterClauses([{ field: 'email', operator: 'eq', value: 'a@b.com' }]);
    expect(clauses[0]).toContain("attributes->>'email'");
  });

  it('generates ILIKE for contains operator on core column', () => {
    const { clauses } = buildFilterClauses([{ field: 'label', operator: 'contains', value: 'Acme' }]);
    expect(clauses[0]).toContain('ILIKE');
  });

  it('generates numeric cast for gt on attribute field', () => {
    const { clauses } = buildFilterClauses([{ field: 'amount', operator: 'gt', value: '1000' }]);
    expect(clauses[0]).toContain('::numeric >');
  });

  it('builds multiple clauses', () => {
    const filters = [
      { field: 'type', operator: 'eq' as const, value: 'contact' },
      { field: 'status', operator: 'eq' as const, value: 'active' },
    ];
    const { clauses, params } = buildFilterClauses(filters);
    expect(clauses).toHaveLength(2);
    expect(params).toEqual(['contact', 'active']);
  });

  it('parameterizes values to prevent SQL injection', () => {
    const { clauses, params } = buildFilterClauses([{ field: 'type', operator: 'eq', value: "'; DROP TABLE entities;--" }]);
    expect(clauses[0]).toContain('$1');
    expect(params[0]).toBe("'; DROP TABLE entities;--");
    expect(clauses[0]).not.toContain('DROP TABLE');
  });
});

describe('EntitySearchEngine', () => {
  describe('searchEntities', () => {
    it('returns results and pagination cursor', async () => {
      const entityRow = { entity_id: 'e-1', entity_type: 'contact', label: 'Alice', connector_id: 'hubspot', workspace_id: 'ws-1', attributes: '{}', score: 0.9 };
      const facetRow = { value: 'contact', count: '5' };
      const sql = makeSql([[entityRow], [facetRow]]);
      const engine = new EntitySearchEngine(sql as unknown as Parameters<typeof EntitySearchEngine>[0]);
      const result = await engine.searchEntities('ws-1', 'Alice', 'type:contact');
      expect(result.isOk()).toBe(true);
      const resp = result._unsafeUnwrap();
      expect(resp.results).toHaveLength(1);
      expect(resp.results[0]?.entityId).toBe('e-1');
      expect(resp.nextCursor).toBeNull();
    });

    it('sets nextCursor when more results exist', async () => {
      // Return limit+1 rows to trigger has-more
      const rows = Array.from({ length: 51 }, (_, i) => ({
        entity_id: `e-${i}`, entity_type: 'contact', label: `Entity ${i}`,
        connector_id: 'hubspot', workspace_id: 'ws-1', attributes: '{}', score: 0.8,
      }));
      const sql = makeSql([rows, []]);
      const engine = new EntitySearchEngine(sql as unknown as Parameters<typeof EntitySearchEngine>[0]);
      const result = await engine.searchEntities('ws-1', '', '', 50);
      expect(result.isOk()).toBe(true);
      const resp = result._unsafeUnwrap();
      expect(resp.results).toHaveLength(50);
      expect(resp.nextCursor).toBe('e-49');
    });

    it('returns error on DB failure', async () => {
      const sql = vi.fn(async () => { throw new Error('db error'); });
      const engine = new EntitySearchEngine(sql as unknown as Parameters<typeof EntitySearchEngine>[0]);
      const result = await engine.searchEntities('ws-1', '', '');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('suggestFilters', () => {
    it('suggests matching filters', async () => {
      const sql = makeSql([]);
      const engine = new EntitySearchEngine(sql as unknown as Parameters<typeof EntitySearchEngine>[0]);
      const result = await engine.suggestFilters('type:');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().some(s => s.startsWith('type:'))).toBe(true);
    });

    it('returns empty for non-matching prefix', async () => {
      const sql = makeSql([]);
      const engine = new EntitySearchEngine(sql as unknown as Parameters<typeof EntitySearchEngine>[0]);
      const result = await engine.suggestFilters('zzz:');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });
});
