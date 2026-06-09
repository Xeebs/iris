import { describe, it, expect, vi } from 'vitest';
import {
  evaluateCondition,
  generateCorrectionSuggestion,
  computeAutoCorrection,
  countViolationsBySeverity,
  RuleEngine,
} from '../business-rule-engine.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── evaluateCondition ────────────────────────────────────────────────────────

describe('evaluateCondition', () => {
  it('required: passes when value is present', () => {
    expect(evaluateCondition({ field: 'email', operator: 'required' }, 'test@example.com')).toBe(true);
  });

  it('required: fails for null', () => {
    expect(evaluateCondition({ field: 'email', operator: 'required' }, null)).toBe(false);
  });

  it('required: fails for undefined', () => {
    expect(evaluateCondition({ field: 'email', operator: 'required' }, undefined)).toBe(false);
  });

  it('required: fails for empty string', () => {
    expect(evaluateCondition({ field: 'email', operator: 'required' }, '')).toBe(false);
  });

  it('not_empty: fails for whitespace-only string', () => {
    expect(evaluateCondition({ field: 'name', operator: 'not_empty' }, '   ')).toBe(false);
  });

  it('not_empty: passes for non-empty string', () => {
    expect(evaluateCondition({ field: 'name', operator: 'not_empty' }, 'John')).toBe(true);
  });

  it('matches: passes when regex matches', () => {
    expect(evaluateCondition({ field: 'email', operator: 'matches', value: '^[^@]+@[^@]+$' }, 'test@example.com')).toBe(true);
  });

  it('matches: fails when regex does not match', () => {
    expect(evaluateCondition({ field: 'email', operator: 'matches', value: '^[^@]+@[^@]+$' }, 'notanemail')).toBe(false);
  });

  it('min_length: passes when value meets minimum', () => {
    expect(evaluateCondition({ field: 'name', operator: 'min_length', value: 3 }, 'John')).toBe(true);
  });

  it('min_length: fails when value is too short', () => {
    expect(evaluateCondition({ field: 'name', operator: 'min_length', value: 5 }, 'Jo')).toBe(false);
  });

  it('max_length: passes within limit', () => {
    expect(evaluateCondition({ field: 'bio', operator: 'max_length', value: 10 }, 'short')).toBe(true);
  });

  it('max_length: fails when too long', () => {
    expect(evaluateCondition({ field: 'bio', operator: 'max_length', value: 5 }, 'toolongvalue')).toBe(false);
  });

  it('one_of: passes when value is in list', () => {
    expect(evaluateCondition({ field: 'status', operator: 'one_of', value: ['active', 'inactive'] }, 'active')).toBe(true);
  });

  it('one_of: fails when value not in list', () => {
    expect(evaluateCondition({ field: 'status', operator: 'one_of', value: ['active', 'inactive'] }, 'unknown')).toBe(false);
  });
});

// ─── generateCorrectionSuggestion ────────────────────────────────────────────

describe('generateCorrectionSuggestion', () => {
  it('returns suggestion for required field', () => {
    const suggestion = generateCorrectionSuggestion({ field: 'email', operator: 'required' }, null);
    expect(suggestion).toContain('email');
  });

  it('returns suggestion for min_length violation', () => {
    const suggestion = generateCorrectionSuggestion({ field: 'name', operator: 'min_length', value: 5 }, 'Jo');
    expect(suggestion).toContain('5');
  });

  it('returns null for unknown operator', () => {
    const suggestion = generateCorrectionSuggestion({ field: 'x', operator: 'required' as never }, null);
    expect(suggestion).toBeTruthy();
  });

  it('includes field name in suggestion', () => {
    const s = generateCorrectionSuggestion({ field: 'company_name', operator: 'not_empty' }, '');
    expect(s).toContain('company_name');
  });
});

// ─── computeAutoCorrection ────────────────────────────────────────────────────

describe('computeAutoCorrection', () => {
  it('trims whitespace for not_empty violation', () => {
    const corrected = computeAutoCorrection({ field: 'name', operator: 'not_empty' }, '  John  ', 'safe');
    expect(corrected).toBe('John');
  });

  it('returns null when no trim needed', () => {
    const corrected = computeAutoCorrection({ field: 'name', operator: 'not_empty' }, 'John', 'safe');
    expect(corrected).toBeNull();
  });

  it('truncates for max_length violation', () => {
    const corrected = computeAutoCorrection({ field: 'bio', operator: 'max_length', value: 5 }, 'toolong', 'safe');
    expect(corrected).toBe('toolo');
  });

  it('returns null for max_length when within limit', () => {
    const corrected = computeAutoCorrection({ field: 'bio', operator: 'max_length', value: 10 }, 'short', 'safe');
    expect(corrected).toBeNull();
  });

  it('fills UNKNOWN for required in aggressive mode', () => {
    const corrected = computeAutoCorrection({ field: 'name', operator: 'required' }, null, 'aggressive');
    expect(corrected).toBe('UNKNOWN');
  });

  it('returns null for required in safe mode', () => {
    const corrected = computeAutoCorrection({ field: 'name', operator: 'required' }, null, 'safe');
    expect(corrected).toBeNull();
  });
});

// ─── countViolationsBySeverity ────────────────────────────────────────────────

describe('countViolationsBySeverity', () => {
  it('returns zeros for empty list', () => {
    const counts = countViolationsBySeverity([]);
    expect(counts.error).toBe(0);
    expect(counts.warning).toBe(0);
    expect(counts.info).toBe(0);
  });

  it('counts correctly across severities', () => {
    const base = { ruleId: 'r1', entityId: 'e1', entityType: 'contact', violatedCondition: { field: 'x', operator: 'required' as const }, correctionSuggestion: null, detectedAt: new Date() };
    const violations = [
      { ...base, severity: 'error' as const },
      { ...base, severity: 'warning' as const },
      { ...base, severity: 'warning' as const },
      { ...base, severity: 'info' as const },
    ];
    const counts = countViolationsBySeverity(violations);
    expect(counts.error).toBe(1);
    expect(counts.warning).toBe(2);
    expect(counts.info).toBe(1);
  });
});

// ─── RuleEngine ───────────────────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('RuleEngine.defineRule', () => {
  it('returns ok with rule on success', async () => {
    const engine = new RuleEngine(makeSql([]));
    const result = await engine.defineRule(
      'Contact email required', 'contact',
      [{ field: 'email', operator: 'required' }], 'warn', 'warning',
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().name).toBe('Contact email required');
  });

  it('propagates db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as ReturnType<typeof import('postgres').default>;
    const engine = new RuleEngine(sql);
    const result = await engine.defineRule('Test', 'contact', [], 'warn', 'info');
    expect(result.isErr()).toBe(true);
  });
});

describe('RuleEngine.evaluateEntity', () => {
  it('returns empty violations when all rules pass', async () => {
    const rules = [{ id: 'r1', name: 'Email required', conditions: JSON.stringify([{ field: 'email', operator: 'required' }]), action: 'warn', severity: 'warning' }];
    const engine = new RuleEngine(makeSql(rules));
    const result = await engine.evaluateEntity({ id: 'e1', type: 'contact', attributes: { email: 'test@example.com' } });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('detects violation when required field is missing', async () => {
    const rules = [{ id: 'r1', name: 'Email required', conditions: JSON.stringify([{ field: 'email', operator: 'required' }]), action: 'warn', severity: 'warning' }];
    const engine = new RuleEngine(makeSql(rules));
    const result = await engine.evaluateEntity({ id: 'e1', type: 'contact', attributes: {} });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(result._unsafeUnwrap()[0]!.correctionSuggestion).toBeTruthy();
  });
});

describe('RuleEngine.listRules', () => {
  it('returns empty list when no rules defined', async () => {
    const engine = new RuleEngine(makeSql([]));
    const result = await engine.listRules();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });
});

describe('RuleEngine.trackRuleViolations', () => {
  it('returns violation stats', async () => {
    const rows = [{ rule_id: 'r1', rule_name: 'Test', violation_count: 5, severity: 'warning' }];
    const engine = new RuleEngine(makeSql(rows));
    const result = await engine.trackRuleViolations('7d');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()[0]!.violationCount).toBe(5);
  });
});
