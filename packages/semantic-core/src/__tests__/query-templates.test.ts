import { describe, it, expect, vi } from 'vitest';
import {
  extractParameterNames,
  bindParameters,
  validateParameterValues,
  analyzeQueryForOptimizations,
  generateTemplateDescription,
  QueryTemplateManager,
} from '../query-templates.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── extractParameterNames ────────────────────────────────────────────────────

describe('extractParameterNames', () => {
  it('extracts single parameter', () => {
    expect(extractParameterNames('SELECT * FROM {{table}}')).toEqual(['table']);
  });

  it('extracts multiple distinct parameters', () => {
    const params = extractParameterNames('SELECT {{cols}} FROM {{table}} WHERE id = {{id}}');
    expect(params).toContain('cols');
    expect(params).toContain('table');
    expect(params).toContain('id');
    expect(params).toHaveLength(3);
  });

  it('deduplicates repeated parameters', () => {
    expect(extractParameterNames('{{x}} AND {{x}}')).toEqual(['x']);
  });

  it('returns empty for query with no parameters', () => {
    expect(extractParameterNames('SELECT id FROM entities')).toEqual([]);
  });
});

// ─── bindParameters ───────────────────────────────────────────────────────────

describe('bindParameters', () => {
  it('replaces single placeholder', () => {
    expect(bindParameters('SELECT * FROM {{table}}', { table: 'contacts' })).toBe('SELECT * FROM contacts');
  });

  it('replaces multiple placeholders', () => {
    expect(bindParameters('{{a}} AND {{b}}', { a: 'foo', b: 'bar' })).toBe('foo AND bar');
  });

  it('leaves unknown placeholders unchanged', () => {
    expect(bindParameters('{{known}} {{unknown}}', { known: 'hi' })).toBe('hi {{unknown}}');
  });

  it('converts number values to string', () => {
    expect(bindParameters('LIMIT {{n}}', { n: 10 })).toBe('LIMIT 10');
  });

  it('converts boolean values to string', () => {
    expect(bindParameters('{{flag}}', { flag: true })).toBe('true');
  });
});

// ─── validateParameterValues ──────────────────────────────────────────────────

describe('validateParameterValues', () => {
  it('returns null when all required params provided', () => {
    const params = [{ name: 'table', type: 'string' as const, required: true }];
    expect(validateParameterValues(params, { table: 'contacts' })).toBeNull();
  });

  it('returns error message for missing required param', () => {
    const params = [{ name: 'table', type: 'string' as const, required: true }];
    const result = validateParameterValues(params, {});
    expect(result).toContain('table');
  });

  it('ignores optional params without values', () => {
    const params = [{ name: 'limit', type: 'number' as const, required: false, defaultValue: 10 }];
    expect(validateParameterValues(params, {})).toBeNull();
  });

  it('returns null for empty param list', () => {
    expect(validateParameterValues([], {})).toBeNull();
  });

  it('lists multiple missing params', () => {
    const params = [
      { name: 'a', type: 'string' as const, required: true },
      { name: 'b', type: 'string' as const, required: true },
    ];
    const result = validateParameterValues(params, {});
    expect(result).toContain('a');
    expect(result).toContain('b');
  });
});

// ─── analyzeQueryForOptimizations ────────────────────────────────────────────

describe('analyzeQueryForOptimizations', () => {
  it('flags LIMIT without ORDER BY', () => {
    const sug = analyzeQueryForOptimizations('SELECT id FROM contacts LIMIT 10');
    expect(sug.some((s) => s.suggestion.includes('ORDER BY'))).toBe(true);
    expect(sug.find((s) => s.suggestion.includes('ORDER BY'))?.impactLevel).toBe('medium');
  });

  it('does not flag LIMIT when ORDER BY is present', () => {
    const sug = analyzeQueryForOptimizations('SELECT id FROM contacts ORDER BY id LIMIT 10');
    expect(sug.every((s) => !s.suggestion.includes('ORDER BY'))).toBe(true);
  });

  it('flags SELECT *', () => {
    const sug = analyzeQueryForOptimizations('SELECT * FROM contacts');
    expect(sug.some((s) => s.suggestion.includes('explicit column'))).toBe(true);
  });

  it('flags missing LIMIT', () => {
    const sug = analyzeQueryForOptimizations('SELECT id FROM contacts');
    expect(sug.some((s) => s.suggestion.includes('LIMIT'))).toBe(true);
    expect(sug.find((s) => s.suggestion.includes('LIMIT'))?.impactLevel).toBe('high');
  });

  it('returns no suggestions for well-formed query', () => {
    const sug = analyzeQueryForOptimizations('SELECT id, name FROM contacts ORDER BY name LIMIT 50');
    expect(sug).toHaveLength(0);
  });
});

// ─── generateTemplateDescription ─────────────────────────────────────────────

describe('generateTemplateDescription', () => {
  it('includes template name', () => {
    const desc = generateTemplateDescription('Top Contacts', []);
    expect(desc).toContain('Top Contacts');
  });

  it('includes parameter names', () => {
    const desc = generateTemplateDescription('My Query', [
      { name: 'workspace', type: 'string', required: true },
    ]);
    expect(desc).toContain('workspace');
  });

  it('handles no parameters', () => {
    expect(generateTemplateDescription('Simple', [])).not.toContain('parameters');
  });
});

// ─── QueryTemplateManager ─────────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('QueryTemplateManager.createTemplate', () => {
  it('returns ok with template on success', async () => {
    const sql = makeSql([]);
    const mgr = new QueryTemplateManager(sql);
    const result = await mgr.createTemplate('Top Contacts', 'SELECT * FROM contacts', [], 'Top contacts', ['crm'], 'workspace', 'ws-1', 'admin');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().name).toBe('Top Contacts');
    expect(result._unsafeUnwrap().usageCount).toBe(0);
  });

  it('propagates db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db down')) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new QueryTemplateManager(sql);
    const result = await mgr.createTemplate('name', 'query', [], '', [], 'private', 'ws-1', 'user');
    expect(result.isErr()).toBe(true);
  });
});

describe('QueryTemplateManager.instantiateTemplate', () => {
  it('returns bound query', async () => {
    const sql = vi.fn().mockResolvedValue([{
      query: 'SELECT * FROM {{table}} LIMIT {{limit}}',
      parameters: JSON.stringify([
        { name: 'table', type: 'string', required: true },
        { name: 'limit', type: 'number', required: false, defaultValue: 10 },
      ]),
    }]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new QueryTemplateManager(sql);
    const result = await mgr.instantiateTemplate('t1', { table: 'contacts' });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().query).toContain('contacts');
    expect(result._unsafeUnwrap().query).toContain('10');
  });

  it('returns err for unknown template', async () => {
    const sql = makeSql([]);
    const mgr = new QueryTemplateManager(sql);
    const result = await mgr.instantiateTemplate('unknown', {});
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns err for missing required parameter', async () => {
    const sql = vi.fn().mockResolvedValue([{
      query: '{{table}}',
      parameters: JSON.stringify([{ name: 'table', type: 'string', required: true }]),
    }]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new QueryTemplateManager(sql);
    const result = await mgr.instantiateTemplate('t1', {});
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Missing required');
  });
});

describe('QueryTemplateManager.suggestOptimizations', () => {
  it('returns suggestions for suboptimal query', async () => {
    const sql = makeSql([{ query: 'SELECT * FROM contacts LIMIT 5' }]);
    const mgr = new QueryTemplateManager(sql);
    const result = await mgr.suggestOptimizations('t1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().length).toBeGreaterThan(0);
    expect(result._unsafeUnwrap()[0]!.templateId).toBe('t1');
  });

  it('returns err for unknown template', async () => {
    const sql = makeSql([]);
    const mgr = new QueryTemplateManager(sql);
    const result = await mgr.suggestOptimizations('unknown');
    expect(result.isErr()).toBe(true);
  });
});
