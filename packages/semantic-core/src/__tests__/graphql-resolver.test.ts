import { describe, it, expect, vi } from 'vitest';
import {
  executeOperation,
  enforceTokenBudget,
  isAuthorized,
  type GraphQLContext,
} from '../graphql-resolver.js';
import { parseOperation } from '../graphql-schema.js';

function makeSql(returnValue: unknown = []) {
  const fn = vi.fn().mockResolvedValue(returnValue);
  return fn as unknown as GraphQLContext['sql'];
}

function makeCtx(overrides: Partial<GraphQLContext> = {}): GraphQLContext {
  return {
    sql: makeSql(),
    workspaceId: 'ws-test',
    userId: 'user-1',
    contextBudget: 2000,
    ...overrides,
  };
}

describe('executeOperation — query resolvers', () => {
  it('executes entity query and wraps result in data envelope', async () => {
    const row = { id: 'ent-1', type: 'contact', label: 'Alice', workspaceId: 'ws-test' };
    const ctx = makeCtx({ sql: makeSql([row]) });
    const op = parseOperation('query { entity(id: "ent-1", workspaceId: "ws-test") { id label } }')!;
    const result = await executeOperation(op, {}, ctx, 'query { entity }');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().data?.['entity']).toEqual(row);
  });

  it('returns null for entity not found', async () => {
    const ctx = makeCtx({ sql: makeSql([]) });
    const op = parseOperation('query { entity(id: "missing", workspaceId: "ws-test") { id } }')!;
    const result = await executeOperation(op, {}, ctx, 'query { entity }');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().data?.['entity']).toBeNull();
  });

  it('executes entities query with truncation flag', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `ent-${i}`, type: 'contact', label: `Contact ${i}` }));
    const ctx = makeCtx({ sql: makeSql(rows) });
    const op = parseOperation('query { entities(filter: { workspaceId: "ws-test" }) { entities { id } truncated } }')!;
    const result = await executeOperation(op, {}, ctx, 'query { entities }');
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap().data?.['entities'] as { truncated: boolean };
    expect(data?.truncated).toBe(true);
  });

  it('executes metrics query', async () => {
    const metricRow = { id: 'm1', name: 'revenue', value: 50000, unit: 'USD' };
    const ctx = makeCtx({ sql: makeSql([metricRow]) });
    const op = parseOperation('query { metrics(workspaceId: "ws-test") { name value } }')!;
    const result = await executeOperation(op, {}, ctx, 'query { metrics }');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().data?.['metrics']).toEqual([metricRow]);
  });

  it('executes glossary query', async () => {
    const termRow = { term: 'MRR', definition: 'Monthly Recurring Revenue' };
    const ctx = makeCtx({ sql: makeSql([termRow]) });
    const op = parseOperation('query { glossary(workspaceId: "ws-test") { term definition } }')!;
    const result = await executeOperation(op, {}, ctx, 'query { glossary }');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().data?.['glossary']).toEqual([termRow]);
  });

  it('executes lineage query', async () => {
    const node = { entityId: 'ent-1', label: 'Alice', depth: 1, direction: 'upstream' };
    const ctx = makeCtx({ sql: makeSql([node]) });
    const op = parseOperation('query { lineage(entityId: "ent-1", workspaceId: "ws-test") { entityId depth } }')!;
    const result = await executeOperation(op, {}, ctx, 'query { lineage }');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().data?.['lineage']).toEqual([node]);
  });

  it('returns error response for unknown root field', async () => {
    const ctx = makeCtx();
    const op = parseOperation('query { unknownField(workspaceId: "ws-test") { id } }')!;
    const result = await executeOperation(op, {}, ctx, 'query { unknownField }');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().errors?.[0]?.message).toContain('Unknown field');
  });

  it('returns subscription-specific guidance for subscription type', async () => {
    const ctx = makeCtx();
    const op = parseOperation('subscription { onEntityChanged(workspaceId: "ws-test") { id } }')!;
    const result = await executeOperation(op, {}, ctx, 'subscription { onEntityChanged }');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().errors?.[0]?.message).toContain('WebSocket');
  });
});

describe('executeOperation — mutation resolvers', () => {
  it('creates an entity and returns success', async () => {
    const ctx = makeCtx({ sql: makeSql([]) });
    const op = parseOperation('mutation { createEntity(input: { type: "contact", label: "Bob" }) { success } }')!;
    const result = await executeOperation(op, { input: { type: 'contact', label: 'Bob', workspaceId: 'ws-test' } }, ctx, 'mutation');
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap().data?.['createEntity'] as { success: boolean };
    expect(data?.success).toBe(true);
  });

  it('updates an entity', async () => {
    const ctx = makeCtx({ sql: makeSql([]) });
    const op = parseOperation('mutation { updateEntity(input: { id: "ent-1", label: "Updated" }) { success } }')!;
    const result = await executeOperation(op, { input: { id: 'ent-1', label: 'Updated' } }, ctx, 'mutation');
    expect(result.isOk()).toBe(true);
  });

  it('deletes an entity', async () => {
    const ctx = makeCtx({ sql: makeSql([]) });
    const op = parseOperation('mutation { deleteEntity(id: "ent-1", workspaceId: "ws-test") { success } }')!;
    const result = await executeOperation(op, {}, ctx, 'mutation');
    expect(result.isOk()).toBe(true);
  });

  it('executes runQuery mutation', async () => {
    const rows = [{ id: 'e1', type: 'contact', label: 'Alice' }];
    const ctx = makeCtx({ sql: makeSql(rows) });
    const op = parseOperation('mutation { runQuery(query: "find contacts") { entities { id } totalCount } }')!;
    const result = await executeOperation(op, {}, ctx, 'mutation');
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap().data?.['runQuery'] as { totalCount: number };
    expect(data?.totalCount).toBe(1);
  });
});

describe('enforceTokenBudget', () => {
  it('passes through response under budget', () => {
    const resp = { data: { x: 1 }, extensions: { tokensBudgetUsed: 100 } };
    expect(enforceTokenBudget(resp, 500)).toBe(resp);
  });

  it('appends truncation error when over budget', () => {
    const resp = { data: { x: 1 }, extensions: { tokensBudgetUsed: 600 } };
    const result = enforceTokenBudget(resp, 500);
    expect(result.errors?.[0]?.message).toContain('truncated');
  });

  it('passes through when no extensions', () => {
    const resp = { data: { x: 1 } };
    expect(enforceTokenBudget(resp, 500)).toBe(resp);
  });
});

describe('isAuthorized', () => {
  it('allows queries for viewer role', () => {
    const op = parseOperation('query { entities { id } }')!;
    expect(isAuthorized(op, 'viewer')).toBe(true);
  });

  it('blocks mutations for viewer role', () => {
    const op = parseOperation('mutation { createEntity { success } }')!;
    expect(isAuthorized(op, 'viewer')).toBe(false);
  });

  it('allows mutations for editor role', () => {
    const op = parseOperation('mutation { createEntity { success } }')!;
    expect(isAuthorized(op, 'editor')).toBe(true);
  });

  it('allows subscriptions for all roles', () => {
    const op = parseOperation('subscription { onEntityChanged { id } }')!;
    expect(isAuthorized(op, 'viewer')).toBe(true);
    expect(isAuthorized(op, 'editor')).toBe(true);
    expect(isAuthorized(op, 'admin')).toBe(true);
  });
});
