import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityValidationEngine } from '../entity-validator.js';
import type { ValidationRule, ValidationRuleDefinition } from '../entity-validator.js';
import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'contact:123',
    type: 'contact',
    label: 'Alice Smith',
    attributes: {
      email: 'alice@example.com',
      phone: '+1 555-000-1234',
      status: 'active',
      arr: 5000,
    },
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: 'contact:123',
    ...overrides,
  };
}

function makeRule(
  definition: ValidationRuleDefinition,
  overrides: Partial<ValidationRule> = {}
): ValidationRule {
  return {
    ruleId: 'rule-1',
    workspaceId: 'ws-1',
    entityType: 'contact',
    ruleName: 'Test rule',
    definition,
    isBlocking: true,
    severity: 'error',
    createdByUserId: 'user-1',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSql(rows: unknown[] = []) {
  // services call sql.json() for jsonb params; echo the value through
  const fn = Object.assign(vi.fn().mockResolvedValue(rows), { json: (v: unknown) => v });
  return fn as unknown as ConstructorParameters<typeof EntityValidationEngine>[0];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EntityValidationEngine', () => {
  let engine: EntityValidationEngine;
  let sql: ReturnType<typeof makeSql>;

  beforeEach(() => {
    sql = makeSql();
    engine = new EntityValidationEngine(sql);
  });

  // ── createRule ─────────────────────────────────────────────────────────────

  describe('createRule', () => {
    it('inserts rule and returns stored row', async () => {
      const returned = {
        rule_id: 'r-1',
        workspace_id: 'ws-1',
        entity_type: 'contact',
        rule_name: 'Email required',
        rule_definition: { type: 'required', field: 'email' },
        is_blocking: true,
        severity: 'error',
        created_by_user_id: 'user-1',
        created_at: new Date().toISOString(),
      };
      sql.mockResolvedValueOnce([returned]);

      const result = await engine.createRule({
        workspaceId: 'ws-1',
        entityType: 'contact',
        ruleName: 'Email required',
        definition: { type: 'required', field: 'email' },
        isBlocking: true,
        severity: 'error',
        createdByUserId: 'user-1',
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().ruleId).toBe('r-1');
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('DB error'));
      const result = await engine.createRule({
        workspaceId: 'ws-1',
        entityType: 'contact',
        ruleName: 'X',
        definition: { type: 'required', field: 'email' },
        isBlocking: true,
        severity: 'error',
        createdByUserId: 'u-1',
      });
      expect(result.isErr()).toBe(true);
    });
  });

  // ── validateEntity — required rule ────────────────────────────────────────

  describe('validateEntity — required rule', () => {
    it('passes when required field is present', async () => {
      const rule = makeRule({ type: 'required', field: 'email' });
      sql.mockResolvedValueOnce([
        {
          rule_id: rule.ruleId,
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: rule.ruleName,
          rule_definition: rule.definition,
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity();
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('fails when required field is missing', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Email required',
          rule_definition: { type: 'required', field: 'email' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: {} });
      const result = await engine.validateEntity(entity, 'ws-1');
      const vr = result._unsafeUnwrap();
      expect(vr.valid).toBe(false);
      expect(vr.blocked).toBe(true);
      expect(vr.failures[0]?.failureReason).toMatch(/email/i);
    });

    it('treats empty string as missing for required', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Status required',
          rule_definition: { type: 'required', field: 'status' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { status: '' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(false);
    });
  });

  // ── validateEntity — type rule ─────────────────────────────────────────────

  describe('validateEntity — type rule', () => {
    it('passes when field has correct type', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'ARR is number',
          rule_definition: { type: 'type', field: 'arr', expectedType: 'number' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { arr: 9999 } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('fails when field type is wrong', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'ARR is number',
          rule_definition: { type: 'type', field: 'arr', expectedType: 'number' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { arr: 'not-a-number' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('accepts missing field without failing type rule', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'ARR is number',
          rule_definition: { type: 'type', field: 'arr', expectedType: 'number' },
          is_blocking: false,
          severity: 'warning',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: {} });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(true);
    });
  });

  // ── validateEntity — email rule ───────────────────────────────────────────

  describe('validateEntity — email rule', () => {
    it('passes for valid email', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Valid email',
          rule_definition: { type: 'email', field: 'email' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity();
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('fails for invalid email format', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Valid email',
          rule_definition: { type: 'email', field: 'email' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { email: 'not-an-email' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(false);
    });
  });

  // ── validateEntity — cross_field rule ─────────────────────────────────────

  describe('validateEntity — cross_field rule', () => {
    it('passes when condition not met (rule does not apply)', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Closed needs closedAt',
          rule_definition: {
            type: 'cross_field',
            condition: { field: 'status', operator: 'eq', value: 'closed' },
            requirement: { field: 'closedAt', operator: 'exists', message: 'closedAt must be set when status=closed' },
          },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { status: 'active' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('fails when condition is met but requirement is not', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Closed needs closedAt',
          rule_definition: {
            type: 'cross_field',
            condition: { field: 'status', operator: 'eq', value: 'closed' },
            requirement: { field: 'closedAt', operator: 'exists', message: 'closedAt must be set when status=closed' },
          },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { status: 'closed' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      const vr = result._unsafeUnwrap();
      expect(vr.valid).toBe(false);
      expect(vr.failures[0]?.failureReason).toMatch(/closedAt/);
    });

    it('passes when condition is met and requirement is satisfied', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Closed needs closedAt',
          rule_definition: {
            type: 'cross_field',
            condition: { field: 'status', operator: 'eq', value: 'closed' },
            requirement: { field: 'closedAt', operator: 'exists' },
          },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { status: 'closed', closedAt: '2026-01-15' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(true);
    });
  });

  // ── validateEntity — enum rule ────────────────────────────────────────────

  describe('validateEntity — enum rule', () => {
    it('fails for value not in enum', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Valid status',
          rule_definition: { type: 'enum', field: 'status', allowedValues: ['active', 'inactive', 'closed'] },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { status: 'deleted' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('passes for value in enum', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Valid status',
          rule_definition: { type: 'enum', field: 'status', allowedValues: ['active', 'inactive', 'closed'] },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { status: 'active' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(true);
    });
  });

  // ── validateEntity — range rule ───────────────────────────────────────────

  describe('validateEntity — range rule', () => {
    it('fails when value is below minimum', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'ARR positive',
          rule_definition: { type: 'range', field: 'arr', min: 0 },
          is_blocking: false,
          severity: 'warning',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { arr: -500 } });
      const result = await engine.validateEntity(entity, 'ws-1');
      const vr = result._unsafeUnwrap();
      expect(vr.warnings.length).toBe(1);
      expect(vr.blocked).toBe(false);
    });

    it('fails when value exceeds maximum', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'ARR cap',
          rule_definition: { type: 'range', field: 'arr', max: 1_000_000 },
          is_blocking: false,
          severity: 'warning',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { arr: 2_000_000 } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().warnings.length).toBe(1);
    });
  });

  // ── validateEntity — regex rule ───────────────────────────────────────────

  describe('validateEntity — regex rule', () => {
    it('fails when field does not match pattern', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Account ID format',
          rule_definition: { type: 'regex', field: 'accountId', pattern: '^ACC-\\d{4}$' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { accountId: 'BADFORMAT' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('passes when field matches pattern', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Account ID format',
          rule_definition: { type: 'regex', field: 'accountId', pattern: '^ACC-\\d{4}$' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { accountId: 'ACC-1234' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(true);
    });
  });

  // ── validateBatch ─────────────────────────────────────────────────────────

  describe('validateBatch', () => {
    it('returns empty arrays for empty input', async () => {
      const result = await engine.validateBatch([], 'ws-1');
      expect(result._unsafeUnwrap()).toEqual({ passed: [], results: [] });
    });

    it('separates blocked from passed entities', async () => {
      const ruleRow = {
        rule_id: 'r-1',
        workspace_id: 'ws-1',
        entity_type: 'contact',
        rule_name: 'Email required',
        rule_definition: { type: 'required', field: 'email' },
        is_blocking: true,
        severity: 'error',
        created_by_user_id: 'u-1',
        created_at: new Date().toISOString(),
      };
      sql
        .mockResolvedValueOnce([ruleRow])
        .mockResolvedValueOnce([]);

      const entities = [
        makeEntity({ id: 'c:1', attributes: { email: 'a@b.com' } }),
        makeEntity({ id: 'c:2', attributes: {} }),
      ];

      const result = await engine.validateBatch(entities, 'ws-1');
      const { passed, results } = result._unsafeUnwrap();
      expect(passed.length).toBe(1);
      expect(passed[0]?.id).toBe('c:1');
      expect(results.length).toBe(2);
      expect(results.find(r => r.entityId === 'c:2')?.blocked).toBe(true);
    });

    it('non-blocking rule does not prevent indexing', async () => {
      const ruleRow = {
        rule_id: 'r-1',
        workspace_id: 'ws-1',
        entity_type: 'contact',
        rule_name: 'ARR positive',
        rule_definition: { type: 'range', field: 'arr', min: 0 },
        is_blocking: false,
        severity: 'warning',
        created_by_user_id: 'u-1',
        created_at: new Date().toISOString(),
      };
      sql
        .mockResolvedValueOnce([ruleRow])
        .mockResolvedValueOnce([]);

      const entities = [makeEntity({ attributes: { arr: -100 } })];
      const result = await engine.validateBatch(entities, 'ws-1');
      const { passed } = result._unsafeUnwrap();
      expect(passed.length).toBe(1);
    });
  });

  // ── acknowledgeFailure ────────────────────────────────────────────────────

  describe('acknowledgeFailure', () => {
    it('calls UPDATE with correct params', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await engine.acknowledgeFailure('ws-1', 'failure-uuid');
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalled();
    });
  });

  // ── min/max length rules ──────────────────────────────────────────────────

  describe('min_length and max_length rules', () => {
    it('fails when string is shorter than min_length', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Label min length',
          rule_definition: { type: 'min_length', field: 'label', minLength: 5 },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ label: 'Al' });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('fails when string exceeds max_length', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Note max length',
          rule_definition: { type: 'max_length', field: 'note', maxLength: 10 },
          is_blocking: false,
          severity: 'warning',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { note: 'This is a very long note that exceeds the limit' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().warnings.length).toBe(1);
    });
  });

  // ── phone rule ────────────────────────────────────────────────────────────

  describe('phone rule', () => {
    it('passes for valid E164-style phone', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Phone format',
          rule_definition: { type: 'phone', field: 'phone' },
          is_blocking: false,
          severity: 'warning',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity();
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().warnings.length).toBe(0);
    });

    it('fails for non-numeric garbage', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Phone format',
          rule_definition: { type: 'phone', field: 'phone' },
          is_blocking: false,
          severity: 'warning',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const entity = makeEntity({ attributes: { phone: 'abc-def' } });
      const result = await engine.validateEntity(entity, 'ws-1');
      expect(result._unsafeUnwrap().warnings.length).toBe(1);
    });
  });

  // ── listRules ─────────────────────────────────────────────────────────────

  describe('listRules', () => {
    it('returns rules for workspace', async () => {
      sql.mockResolvedValueOnce([
        {
          rule_id: 'r-1',
          workspace_id: 'ws-1',
          entity_type: 'contact',
          rule_name: 'Email required',
          rule_definition: { type: 'required', field: 'email' },
          is_blocking: true,
          severity: 'error',
          created_by_user_id: 'u-1',
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await engine.listRules('ws-1');
      expect(result._unsafeUnwrap().length).toBe(1);
    });

    it('returns empty array when no rules', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await engine.listRules('ws-empty');
      expect(result._unsafeUnwrap()).toEqual([]);
    });
  });

  // ── generateReport ────────────────────────────────────────────────────────

  describe('generateReport', () => {
    it('returns a report with entity and failure counts', async () => {
      sql
        .mockResolvedValueOnce([{ total: 100 }])
        .mockResolvedValueOnce([
          { rule_id: 'r-1', rule_name: 'Email required', severity: 'error', count: 10 },
        ]);

      const result = await engine.generateReport('ws-1');
      const report = result._unsafeUnwrap();
      expect(report.totalEntities).toBe(100);
      expect(report.invalidCount).toBe(10);
      expect(report.failuresByRule.length).toBe(1);
    });
  });
});
