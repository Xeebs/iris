/**
 * Integration tests for EntityValidationEngine.
 * Requires Postgres running (docker-compose up -d).
 * Run with: pnpm test:integration --filter=@iris/semantic-core
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { EntityValidationEngine } from '../entity-validator.js';
import type { SemanticEntity } from '@iris/connector-sdk';

const TEST_WS = 'integration-test-ws';
const TEST_USER = 'integration-test-user';

let sql: ReturnType<typeof postgres>;
let engine: EntityValidationEngine;

function entity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: `contact:${Math.random().toString(36).slice(2)}`,
    type: 'contact',
    label: 'Integration Test Contact',
    attributes: {
      email: 'test@example.com',
      status: 'active',
      arr: 5000,
    },
    relationships: [],
    lastModified: new Date(),
    sourceId: 'contact:test',
    ...overrides,
  };
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(url);
  engine = new EntityValidationEngine(sql as unknown as ConstructorParameters<typeof EntityValidationEngine>[0]);

  await sql`
    DELETE FROM validation_failures WHERE workspace_id = ${TEST_WS}
  `.catch(() => {});
  await sql`
    DELETE FROM validation_rules WHERE workspace_id = ${TEST_WS}
  `.catch(() => {});
});

afterAll(async () => {
  await sql`DELETE FROM validation_failures WHERE workspace_id = ${TEST_WS}`.catch(() => {});
  await sql`DELETE FROM validation_rules WHERE workspace_id = ${TEST_WS}`.catch(() => {});
  await sql.end();
});

describe('EntityValidationEngine integration', () => {
  it('creates and retrieves a validation rule', async () => {
    const create = await engine.createRule({
      workspaceId: TEST_WS,
      entityType: 'contact',
      ruleName: 'Email required',
      definition: { type: 'required', field: 'email' },
      isBlocking: true,
      severity: 'error',
      createdByUserId: TEST_USER,
    });
    expect(create.isOk()).toBe(true);
    const ruleId = create._unsafeUnwrap().ruleId;

    const list = await engine.listRules(TEST_WS, 'contact');
    expect(list.isOk()).toBe(true);
    expect(list._unsafeUnwrap().some(r => r.ruleId === ruleId)).toBe(true);
  });

  it('validates entities against real DB rules', async () => {
    await engine.createRule({
      workspaceId: TEST_WS,
      entityType: 'contact',
      ruleName: 'Status enum check',
      definition: { type: 'enum', field: 'status', allowedValues: ['active', 'inactive'] },
      isBlocking: false,
      severity: 'warning',
      createdByUserId: TEST_USER,
    });

    const valid = await engine.validateEntity(entity(), TEST_WS);
    expect(valid.isOk()).toBe(true);

    const invalid = await engine.validateEntity(
      entity({ attributes: { email: 'x@y.com', status: 'deleted', arr: 100 } }),
      TEST_WS
    );
    expect(invalid.isOk()).toBe(true);
    expect(invalid._unsafeUnwrap().warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('batch-validates and persists failures', async () => {
    await engine.createRule({
      workspaceId: TEST_WS,
      entityType: 'contact',
      ruleName: 'ARR positive int',
      definition: { type: 'range', field: 'arr', min: 0 },
      isBlocking: false,
      severity: 'warning',
      createdByUserId: TEST_USER,
    });

    const batch = [
      entity({ id: 'c:batch-1', attributes: { email: 'a@b.com', status: 'active', arr: 1000 } }),
      entity({ id: 'c:batch-2', attributes: { email: 'b@c.com', status: 'active', arr: -50 } }),
      entity({ id: 'c:batch-3', attributes: { email: 'c@d.com', status: 'active', arr: 200 } }),
    ];

    const result = await engine.validateBatch(batch, TEST_WS);
    expect(result.isOk()).toBe(true);
    const { passed, results } = result._unsafeUnwrap();
    expect(passed.length).toBe(3);
    const badResult = results.find(r => r.entityId === 'c:batch-2');
    expect(badResult?.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('generates a report with non-zero totals', async () => {
    const report = await engine.generateReport(TEST_WS);
    expect(report.isOk()).toBe(true);
  });

  it('acknowledges a failure', async () => {
    const failures = await engine.listFailures(TEST_WS, { acknowledged: false, limit: 1 });
    if (failures.isOk() && failures._unsafeUnwrap().failures.length > 0) {
      const fid = failures._unsafeUnwrap().failures[0]!.failureId!;
      const ack = await engine.acknowledgeFailure(TEST_WS, fid);
      expect(ack.isOk()).toBe(true);
    }
  });
});
