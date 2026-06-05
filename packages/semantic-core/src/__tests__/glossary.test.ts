import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GlossaryService } from '../glossary.js';

const mockSql = vi.fn();

function makeSql() {
  const proxy = new Proxy(mockSql, {
    get: (_t, prop: string | symbol) => {
      if (prop === 'count') return undefined;
      return undefined;
    },
    apply: (_t, _this, args: unknown[]) => mockSql(...args),
  });
  return proxy as unknown as Parameters<typeof GlossaryService>[0];
}

const WORKSPACE = 'ws-123';

describe('GlossaryService', () => {
  let service: GlossaryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GlossaryService(makeSql());
  });

  describe('addTerm()', () => {
    it('returns ok with the new term on success', async () => {
      const fakeRow = {
        id: 'term-1',
        workspace_id: WORKSPACE,
        term: 'ARR',
        definition: 'Annual Recurring Revenue',
        example_value: '$1.2M',
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockSql.mockResolvedValueOnce([fakeRow]);

      const result = await service.addTerm(WORKSPACE, 'ARR', 'Annual Recurring Revenue', '$1.2M');
      expect(result.isOk()).toBe(true);
      const term = result._unsafeUnwrap();
      expect(term.term).toBe('ARR');
      expect(term.definition).toBe('Annual Recurring Revenue');
      expect(term.exampleValue).toBe('$1.2M');
    });

    it('returns err when DB throws', async () => {
      mockSql.mockRejectedValueOnce(new Error('DB down'));
      const result = await service.addTerm(WORKSPACE, 'ARR', 'def');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('DB down');
    });

    it('returns err when no row returned', async () => {
      mockSql.mockResolvedValueOnce([]);
      const result = await service.addTerm(WORKSPACE, 'ARR', 'def');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getTerm()', () => {
    it('returns ok with term when found', async () => {
      const fakeRow = {
        id: 'term-1',
        workspace_id: WORKSPACE,
        term: 'MRR',
        definition: 'Monthly Recurring Revenue',
        example_value: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockSql.mockResolvedValueOnce([fakeRow]);

      const result = await service.getTerm(WORKSPACE, 'MRR');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()?.term).toBe('MRR');
    });

    it('returns ok with null when not found', async () => {
      mockSql.mockResolvedValueOnce([]);
      const result = await service.getTerm(WORKSPACE, 'UNKNOWN');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  describe('listTerms()', () => {
    it('returns all terms for workspace', async () => {
      const rows = [
        { id: '1', workspace_id: WORKSPACE, term: 'ARR', definition: 'def1', example_value: null, created_at: new Date(), updated_at: new Date() },
        { id: '2', workspace_id: WORKSPACE, term: 'MRR', definition: 'def2', example_value: null, created_at: new Date(), updated_at: new Date() },
      ];
      mockSql.mockResolvedValueOnce(rows);

      const result = await service.listTerms(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('returns filtered terms when filter provided', async () => {
      mockSql.mockResolvedValueOnce([
        { id: '1', workspace_id: WORKSPACE, term: 'ARR', definition: 'def', example_value: null, created_at: new Date(), updated_at: new Date() },
      ]);
      const result = await service.listTerms(WORKSPACE, 'ARR');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });
  });

  describe('deleteTerm()', () => {
    it('returns ok true when term deleted', async () => {
      mockSql.mockResolvedValueOnce({ count: 1 });
      const result = await service.deleteTerm(WORKSPACE, 'ARR');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns ok false when term not found', async () => {
      mockSql.mockResolvedValueOnce({ count: 0 });
      const result = await service.deleteTerm(WORKSPACE, 'NONEXISTENT');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });
  });
});
