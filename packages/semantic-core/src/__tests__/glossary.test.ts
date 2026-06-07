import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GlossaryService } from '../glossary.js';

const mockSql = vi.fn();

function makeSql() {
  const proxy = new Proxy(mockSql, {
    get: (_t, prop: string | symbol) => {
      if (prop === 'count') return undefined;
      return undefined;
    },
    apply: (_t, _this, args: unknown[]) => {
      // When called as a tagged template, args[0] is the TemplateStringsArray.
      // Fragment sub-calls (empty conditions) have no SELECT/FROM — return an inert
      // fragment object so they don't consume the mock's queued return values.
      const strings = args[0] as string[];
      const joined = Array.isArray(strings) ? strings.join('') : '';
      if (!joined.includes('SELECT') && !joined.includes('DELETE') && !joined.includes('INSERT') && !joined.includes('UPDATE')) {
        return { strings, values: args.slice(1) };
      }
      return mockSql(...args);
    },
  });
  return proxy as unknown as Parameters<typeof GlossaryService>[0];
}

const WORKSPACE = 'ws-123';

const BASE_ROW = {
  id: 'term-1',
  workspace_id: WORKSPACE,
  term: 'ARR',
  definition: 'Annual Recurring Revenue',
  example_value: '$1.2M',
  status: 'approved' as const,
  approved_by: null,
  approved_at: null,
  usage_count: 0,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('GlossaryService', () => {
  let service: GlossaryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GlossaryService(makeSql());
  });

  describe('addTerm()', () => {
    it('returns ok with the new term on success', async () => {
      // INSERT returns the term row; history INSERT is the second call (ignored)
      mockSql.mockResolvedValueOnce([BASE_ROW]).mockResolvedValueOnce([]);

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
      mockSql.mockResolvedValueOnce([{ ...BASE_ROW, term: 'MRR', definition: 'Monthly Recurring Revenue', example_value: null }]);
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
        { ...BASE_ROW, id: '1', term: 'ARR' },
        { ...BASE_ROW, id: '2', term: 'MRR' },
      ];
      mockSql.mockResolvedValueOnce(rows);
      const result = await service.listTerms(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('returns filtered terms when filter provided', async () => {
      mockSql.mockResolvedValueOnce([{ ...BASE_ROW, id: '1', term: 'ARR' }]);
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

  describe('approveTerm()', () => {
    it('returns ok with approved term on success', async () => {
      const approvedRow = { ...BASE_ROW, status: 'approved' as const, approved_by: 'user-1', approved_at: new Date() };
      mockSql.mockResolvedValueOnce([approvedRow]);

      const result = await service.approveTerm(WORKSPACE, 'ARR', 'user-1');
      expect(result.isOk()).toBe(true);
      const term = result._unsafeUnwrap();
      expect(term?.status).toBe('approved');
      expect(term?.approvedBy).toBe('user-1');
    });

    it('returns ok with null when term not found', async () => {
      mockSql.mockResolvedValueOnce([]);
      const result = await service.approveTerm(WORKSPACE, 'UNKNOWN', 'user-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns err when DB throws', async () => {
      mockSql.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.approveTerm(WORKSPACE, 'ARR', 'user-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getTermHistory()', () => {
    it('returns history entries ordered by date desc', async () => {
      const rows = [
        { id: 'h2', term_id: 'term-1', workspace_id: WORKSPACE, term: 'ARR', definition: 'Updated def', example_value: null, changed_by: 'user-1', changed_at: new Date('2026-06-07') },
        { id: 'h1', term_id: 'term-1', workspace_id: WORKSPACE, term: 'ARR', definition: 'Original def', example_value: null, changed_by: 'system', changed_at: new Date('2026-06-01') },
      ];
      mockSql.mockResolvedValueOnce(rows);

      const result = await service.getTermHistory(WORKSPACE, 'ARR');
      expect(result.isOk()).toBe(true);
      const history = result._unsafeUnwrap();
      expect(history).toHaveLength(2);
      expect(history[0]?.changedBy).toBe('user-1');
    });

    it('returns empty array when no history', async () => {
      mockSql.mockResolvedValueOnce([]);
      const result = await service.getTermHistory(WORKSPACE, 'ARR');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('getTermUsage()', () => {
    it('returns usage counts ordered by count desc', async () => {
      mockSql.mockResolvedValueOnce([
        { term: 'ARR', usage_count: 15 },
        { term: 'MRR', usage_count: 8 },
      ]);

      const result = await service.getTermUsage(WORKSPACE);
      expect(result.isOk()).toBe(true);
      const usage = result._unsafeUnwrap();
      expect(usage[0]?.term).toBe('ARR');
      expect(usage[0]?.usageCount).toBe(15);
    });
  });

  describe('incrementUsage()', () => {
    it('resolves without error on success', async () => {
      mockSql.mockResolvedValueOnce({ count: 1 });
      await expect(service.incrementUsage(WORKSPACE, 'ARR')).resolves.toBeUndefined();
    });

    it('silently handles DB errors', async () => {
      mockSql.mockRejectedValueOnce(new Error('DB error'));
      await expect(service.incrementUsage(WORKSPACE, 'ARR')).resolves.toBeUndefined();
    });
  });
});
