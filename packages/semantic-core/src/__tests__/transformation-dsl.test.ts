import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransformationDSLEngine } from '../transformation-dsl.js';
import type { TransformationStep } from '../transformation-dsl.js';
import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSql(result: unknown[] = []) {
  // services call sql.json() for jsonb params; echo the value through
  const fn = Object.assign(vi.fn().mockResolvedValue(result), { json: (v: unknown) => v });
  return fn as unknown as ConstructorParameters<typeof TransformationDSLEngine>[0];
}

function makeEntity(attrs: Record<string, unknown> = {}): SemanticEntity {
  return {
    id: 'contact:1',
    type: 'contact',
    label: 'Test Entity',
    attributes: attrs as Record<string, import('@iris/connector-sdk').AttributeValue>,
    relationships: [],
    lastModified: new Date(),
    sourceId: 'contact:1',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TransformationDSLEngine', () => {
  let engine: TransformationDSLEngine;
  let sql: ReturnType<typeof makeSql>;

  beforeEach(() => {
    sql = makeSql();
    engine = new TransformationDSLEngine(sql);
  });

  // ── rename ────────────────────────────────────────────────────────────────

  describe('rename step', () => {
    it('renames a field', () => {
      const step: TransformationStep = { op: 'rename', from: 'firstName', to: 'first_name' };
      const result = engine.testTransformation(
        makeEntity({ firstName: 'Alice' }),
        [step]
      );
      expect(result.output.attributes['first_name']).toBe('Alice');
      expect(result.output.attributes['firstName']).toBeUndefined();
      expect(result.transformedFields).toContain('first_name');
    });

    it('does nothing if source field absent', () => {
      const step: TransformationStep = { op: 'rename', from: 'missing', to: 'target' };
      const result = engine.testTransformation(makeEntity({}), [step]);
      expect(result.transformedFields).toHaveLength(0);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove step', () => {
    it('removes a field', () => {
      const step: TransformationStep = { op: 'remove', field: 'ssn' };
      const result = engine.testTransformation(makeEntity({ ssn: '123', name: 'Alice' }), [step]);
      expect(result.output.attributes['ssn']).toBeUndefined();
      expect(result.output.attributes['name']).toBe('Alice');
    });
  });

  // ── keep_only ─────────────────────────────────────────────────────────────

  describe('keep_only step', () => {
    it('removes all fields not in the keep list', () => {
      const step: TransformationStep = { op: 'keep_only', fields: ['name', 'email'] };
      const result = engine.testTransformation(
        makeEntity({ name: 'Alice', email: 'a@b.com', ssn: '123', phone: '+1' }),
        [step]
      );
      expect(result.output.attributes['name']).toBe('Alice');
      expect(result.output.attributes['email']).toBe('a@b.com');
      expect(result.output.attributes['ssn']).toBeUndefined();
      expect(result.output.attributes['phone']).toBeUndefined();
    });
  });

  // ── normalize_case ────────────────────────────────────────────────────────

  describe('normalize_case step', () => {
    it('uppercases a field', () => {
      const step: TransformationStep = { op: 'normalize_case', field: 'country', mode: 'upper' };
      const result = engine.testTransformation(makeEntity({ country: 'usa' }), [step]);
      expect(result.output.attributes['country']).toBe('USA');
    });

    it('lowercases a field', () => {
      const step: TransformationStep = { op: 'normalize_case', field: 'email', mode: 'lower' };
      const result = engine.testTransformation(makeEntity({ email: 'ALICE@EXAMPLE.COM' }), [step]);
      expect(result.output.attributes['email']).toBe('alice@example.com');
    });

    it('title-cases a field', () => {
      const step: TransformationStep = { op: 'normalize_case', field: 'name', mode: 'title' };
      const result = engine.testTransformation(makeEntity({ name: 'alice smith' }), [step]);
      expect(result.output.attributes['name']).toBe('Alice Smith');
    });

    it('skips non-string fields', () => {
      const step: TransformationStep = { op: 'normalize_case', field: 'arr', mode: 'upper' };
      const result = engine.testTransformation(makeEntity({ arr: 5000 }), [step]);
      expect(result.output.attributes['arr']).toBe(5000);
    });
  });

  // ── trim ──────────────────────────────────────────────────────────────────

  describe('trim step', () => {
    it('trims whitespace from a string field', () => {
      const step: TransformationStep = { op: 'trim', field: 'name' };
      const result = engine.testTransformation(makeEntity({ name: '  Alice  ' }), [step]);
      expect(result.output.attributes['name']).toBe('Alice');
    });
  });

  // ── regex_replace ─────────────────────────────────────────────────────────

  describe('regex_replace step', () => {
    it('replaces matches in a string field', () => {
      const step: TransformationStep = {
        op: 'regex_replace',
        field: 'phone',
        pattern: '[^0-9]',
        replacement: '',
        flags: 'g',
      };
      const result = engine.testTransformation(makeEntity({ phone: '+1 (555) 000-1234' }), [step]);
      expect(result.output.attributes['phone']).toBe('15550001234');
    });
  });

  // ── concat ────────────────────────────────────────────────────────────────

  describe('concat step', () => {
    it('concatenates multiple fields into a target field', () => {
      const step: TransformationStep = {
        op: 'concat',
        fields: ['firstName', 'lastName'],
        separator: ' ',
        targetField: 'fullName',
      };
      const result = engine.testTransformation(
        makeEntity({ firstName: 'Alice', lastName: 'Smith' }),
        [step]
      );
      expect(result.output.attributes['fullName']).toBe('Alice Smith');
    });

    it('skips empty/missing fields', () => {
      const step: TransformationStep = {
        op: 'concat',
        fields: ['a', 'b', 'c'],
        separator: '-',
        targetField: 'combined',
      };
      const result = engine.testTransformation(makeEntity({ a: 'x', c: 'z' }), [step]);
      expect(result.output.attributes['combined']).toBe('x-z');
    });
  });

  // ── extract_substring ─────────────────────────────────────────────────────

  describe('extract_substring step', () => {
    it('extracts substring in-place', () => {
      const step: TransformationStep = {
        op: 'extract_substring',
        field: 'code',
        start: 4,
        end: 8,
      };
      const result = engine.testTransformation(makeEntity({ code: 'ACC-1234-extra' }), [step]);
      expect(result.output.attributes['code']).toBe('1234');
    });

    it('extracts to a target field', () => {
      const step: TransformationStep = {
        op: 'extract_substring',
        field: 'fullCode',
        start: 0,
        end: 3,
        targetField: 'prefix',
      };
      const result = engine.testTransformation(makeEntity({ fullCode: 'ACC-1234' }), [step]);
      expect(result.output.attributes['prefix']).toBe('ACC');
    });
  });

  // ── format_date ───────────────────────────────────────────────────────────

  describe('format_date step', () => {
    it('formats date to ISO string', () => {
      const step: TransformationStep = { op: 'format_date', field: 'createdAt', format: 'iso' };
      const result = engine.testTransformation(
        makeEntity({ createdAt: '2026-01-15T10:00:00Z' }),
        [step]
      );
      expect(String(result.output.attributes['createdAt'])).toMatch(/^2026-01-15/);
    });

    it('formats date to epoch ms', () => {
      const step: TransformationStep = { op: 'format_date', field: 'ts', format: 'epoch_ms' };
      const result = engine.testTransformation(
        makeEntity({ ts: '2026-01-01T00:00:00Z' }),
        [step]
      );
      expect(Number(result.output.attributes['ts'])).toBeGreaterThan(0);
    });

    it('leaves invalid date unchanged', () => {
      const step: TransformationStep = { op: 'format_date', field: 'ts', format: 'iso' };
      const result = engine.testTransformation(makeEntity({ ts: 'not-a-date' }), [step]);
      expect(result.output.attributes['ts']).toBe('not-a-date');
    });
  });

  // ── set_default ───────────────────────────────────────────────────────────

  describe('set_default step', () => {
    it('sets default when field is missing', () => {
      const step: TransformationStep = { op: 'set_default', field: 'status', defaultValue: 'active' };
      const result = engine.testTransformation(makeEntity({}), [step]);
      expect(result.output.attributes['status']).toBe('active');
    });

    it('does not override existing value', () => {
      const step: TransformationStep = { op: 'set_default', field: 'status', defaultValue: 'active' };
      const result = engine.testTransformation(makeEntity({ status: 'closed' }), [step]);
      expect(result.output.attributes['status']).toBe('closed');
    });
  });

  // ── map_value ─────────────────────────────────────────────────────────────

  describe('map_value step', () => {
    it('maps a known value to its replacement', () => {
      const step: TransformationStep = {
        op: 'map_value',
        field: 'stage',
        mapping: { '0': 'prospect', '1': 'qualified', '2': 'closed' },
      };
      const result = engine.testTransformation(makeEntity({ stage: '1' }), [step]);
      expect(result.output.attributes['stage']).toBe('qualified');
    });

    it('applies fallback for unknown values', () => {
      const step: TransformationStep = {
        op: 'map_value',
        field: 'stage',
        mapping: { 'a': 'known' },
        fallback: 'unknown',
      };
      const result = engine.testTransformation(makeEntity({ stage: 'z' }), [step]);
      expect(result.output.attributes['stage']).toBe('unknown');
    });

    it('leaves value unchanged when no mapping and no fallback', () => {
      const step: TransformationStep = {
        op: 'map_value',
        field: 'stage',
        mapping: { 'a': 'known' },
      };
      const result = engine.testTransformation(makeEntity({ stage: 'z' }), [step]);
      expect(result.output.attributes['stage']).toBe('z');
    });
  });

  // ── multi-step chains ─────────────────────────────────────────────────────

  describe('multi-step chains', () => {
    it('applies steps in order', () => {
      const steps: TransformationStep[] = [
        { op: 'rename', from: 'firstName', to: 'name' },
        { op: 'normalize_case', field: 'name', mode: 'upper' },
        { op: 'trim', field: 'name' },
      ];
      const result = engine.testTransformation(makeEntity({ firstName: '  alice  ' }), steps);
      expect(result.output.attributes['name']).toBe('ALICE');
      expect(result.stepsApplied).toBe(3);
    });

    it('reports all changed fields', () => {
      const steps: TransformationStep[] = [
        { op: 'rename', from: 'a', to: 'b' },
        { op: 'set_default', field: 'c', defaultValue: 'default' },
      ];
      const result = engine.testTransformation(makeEntity({ a: 'val' }), steps);
      expect(result.transformedFields).toContain('b');
      expect(result.transformedFields).toContain('c');
    });
  });

  // ── createRule & listRules ────────────────────────────────────────────────

  describe('createRule', () => {
    it('inserts rule and returns stored row', async () => {
      sql.mockResolvedValueOnce([{
        rule_id: 'r-1',
        workspace_id: 'ws-1',
        connector_id: 'hubspot',
        entity_type: 'contact',
        rule_name: 'Normalize names',
        steps: [{ op: 'normalize_case', field: 'name', mode: 'title' }],
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]);

      const result = await engine.createRule({
        workspaceId: 'ws-1',
        connectorId: 'hubspot',
        entityType: 'contact',
        ruleName: 'Normalize names',
        steps: [{ op: 'normalize_case', field: 'name', mode: 'title' }],
        isActive: true,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().ruleId).toBe('r-1');
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('DB error'));
      const result = await engine.createRule({
        workspaceId: 'ws-1',
        connectorId: undefined,
        entityType: undefined,
        ruleName: 'X',
        steps: [],
        isActive: true,
      });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listRules', () => {
    it('returns rules for workspace', async () => {
      sql.mockResolvedValueOnce([{
        rule_id: 'r-1',
        workspace_id: 'ws-1',
        connector_id: null,
        entity_type: null,
        rule_name: 'Normalize',
        steps: [],
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]);

      const result = await engine.listRules('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().length).toBe(1);
    });
  });

  describe('applyToEntities', () => {
    it('returns empty array unchanged', async () => {
      const result = await engine.applyToEntities([], 'ws-1', 'hubspot');
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('applies transformation rules to entities', async () => {
      sql.mockResolvedValueOnce([{
        rule_id: 'r-1',
        workspace_id: 'ws-1',
        connector_id: 'hubspot',
        entity_type: 'contact',
        rule_name: 'Trim names',
        steps: [{ op: 'trim', field: 'name' }],
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]);

      const entities = [makeEntity({ name: '  Alice  ' })];
      const result = await engine.applyToEntities(entities, 'ws-1', 'hubspot');
      expect(result._unsafeUnwrap()[0]?.attributes['name']).toBe('Alice');
    });
  });
});
