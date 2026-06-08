import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFormula, validateFormula, MetricFormulaEngine } from '../metric-formula-engine.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function makeSql(...responses: unknown[][]) {
  let idx = 0;
  const fn = vi.fn().mockImplementation(() => Promise.resolve(responses[idx++] ?? []));
  return fn as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>;
}

// ─── parseFormula ─────────────────────────────────────────────────────────────

describe('parseFormula', () => {
  it('parses simple COUNT', () => {
    const r = parseFormula('COUNT(deal)');
    expect(r.isOk()).toBe(true);
    const p = r._unsafeUnwrap();
    expect(p.left.fn).toBe('COUNT');
    expect(p.left.entityType).toBe('deal');
    expect(p.left.field).toBeNull();
    expect(p.operator).toBeNull();
    expect(p.right).toBeNull();
  });

  it('parses SUM with entity.field', () => {
    const r = parseFormula('SUM(deal.amount)');
    expect(r.isOk()).toBe(true);
    const p = r._unsafeUnwrap();
    expect(p.left.fn).toBe('SUM');
    expect(p.left.entityType).toBe('deal');
    expect(p.left.field).toBe('amount');
  });

  it('parses AVG with entity.field', () => {
    const r = parseFormula('AVG(contact.score)');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().left.fn).toBe('AVG');
  });

  it('parses MIN and MAX', () => {
    for (const fn of ['MIN', 'MAX'] as const) {
      const r = parseFormula(`${fn}(deal.close_date)`);
      expect(r.isOk()).toBe(true);
      expect(r._unsafeUnwrap().left.fn).toBe(fn);
    }
  });

  it('parses ratio formula with division', () => {
    const r = parseFormula('SUM(deal.amount) / COUNT(deal)');
    expect(r.isOk()).toBe(true);
    const p = r._unsafeUnwrap();
    expect(p.operator).toBe('/');
    expect(p.right?.fn).toBe('COUNT');
    expect(p.right?.entityType).toBe('deal');
  });

  it('parses formula with addition', () => {
    const r = parseFormula('COUNT(contact) + COUNT(company)');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().operator).toBe('+');
  });

  it('parses formula with subtraction', () => {
    const r = parseFormula('COUNT(deal) - COUNT(lost_deal)');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().operator).toBe('-');
  });

  it('parses formula with multiplication', () => {
    const r = parseFormula('AVG(deal.amount) * COUNT(deal)');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().operator).toBe('*');
  });

  it('is case-insensitive for function names', () => {
    const r = parseFormula('sum(deal.amount)');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().left.fn).toBe('SUM');
  });

  it('handles whitespace around operator', () => {
    const r = parseFormula('COUNT(deal)  /  COUNT(contact)');
    expect(r.isOk()).toBe(true);
  });

  it('returns err for empty formula', () => {
    const r = parseFormula('');
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()[0]?.message).toContain('empty');
  });

  it('returns err for unknown aggregate function', () => {
    const r = parseFormula('MEDIAN(deal.amount)');
    expect(r.isErr()).toBe(true);
  });

  it('returns err for malformed formula (no parens)', () => {
    const r = parseFormula('SUM deal.amount');
    expect(r.isErr()).toBe(true);
  });

  it('returns err for bare entity type without function', () => {
    const r = parseFormula('deal.amount');
    expect(r.isErr()).toBe(true);
  });

  it('preserves raw formula string', () => {
    const formula = 'SUM(deal.amount) / COUNT(deal)';
    const r = parseFormula(formula);
    expect(r._unsafeUnwrap().raw).toBe(formula);
  });
});

// ─── validateFormula ──────────────────────────────────────────────────────────

describe('validateFormula', () => {
  it('returns empty array for valid formula', () => {
    expect(validateFormula('COUNT(deal)')).toHaveLength(0);
    expect(validateFormula('SUM(deal.amount) / COUNT(deal)')).toHaveLength(0);
  });

  it('returns errors for invalid formula', () => {
    const errors = validateFormula('INVALID(deal)');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toBeTruthy();
  });
});

// ─── MetricFormulaEngine.evaluate ─────────────────────────────────────────────

describe('MetricFormulaEngine.evaluate', () => {
  beforeEach(() => {
    // Clear module-level cache between tests
    const eng = new MetricFormulaEngine(makeSql());
    eng.invalidateCache('test', 'ws-1');
  });

  it('evaluates a simple COUNT formula', async () => {
    const svc = new MetricFormulaEngine(makeSql([{ result: '42' }]));
    const result = await svc.evaluate('m-1', 'ws-1', 'COUNT(deal)');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().value).toBe(42);
    expect(result._unsafeUnwrap().fromCache).toBe(false);
  });

  it('evaluates a SUM formula', async () => {
    const svc = new MetricFormulaEngine(makeSql([{ result: '150000' }]));
    const result = await svc.evaluate('m-2', 'ws-1', 'SUM(deal.amount)');
    expect(result._unsafeUnwrap().value).toBe(150000);
  });

  it('evaluates a ratio formula (SUM/COUNT)', async () => {
    // Two SQL calls: left term, right term
    const svc = new MetricFormulaEngine(makeSql([{ result: '300000' }], [{ result: '10' }]));
    const result = await svc.evaluate('m-3', 'ws-1', 'SUM(deal.amount) / COUNT(deal)');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().value).toBe(30000);
  });

  it('returns 0 when dividing by zero', async () => {
    const svc = new MetricFormulaEngine(makeSql([{ result: '500' }], [{ result: '0' }]));
    const result = await svc.evaluate('m-4', 'ws-1', 'SUM(deal.amount) / COUNT(deal)');
    expect(result._unsafeUnwrap().value).toBe(0);
  });

  it('returns err for invalid formula', async () => {
    const svc = new MetricFormulaEngine(makeSql());
    const result = await svc.evaluate('m-5', 'ws-1', 'GARBAGE(deal)');
    expect(result.isErr()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('DB fail'));
    const svc = new MetricFormulaEngine(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.evaluate('m-6', 'ws-1', 'COUNT(deal)');
    expect(result.isErr()).toBe(true);
  });

  it('returns fromCache=true on second call', async () => {
    const svc = new MetricFormulaEngine(makeSql([{ result: '10' }]));
    await svc.evaluate('m-cache', 'ws-1', 'COUNT(deal)');
    const second = await svc.evaluate('m-cache', 'ws-1', 'COUNT(deal)');
    expect(second._unsafeUnwrap().fromCache).toBe(true);
  });

  it('includes metricId and formula in result', async () => {
    const svc = new MetricFormulaEngine(makeSql([{ result: '7' }]));
    const result = await svc.evaluate('revenue-metric', 'ws-1', 'COUNT(deal)');
    const r = result._unsafeUnwrap();
    expect(r.metricId).toBe('revenue-metric');
    expect(r.formula).toBe('COUNT(deal)');
    expect(r.evaluatedAt).toBeTruthy();
  });
});
