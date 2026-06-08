import { describe, it, expect, vi } from 'vitest';
import { aggregateEntitiesTool } from '../tools/aggregate-entities.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  return vi.fn().mockResolvedValue(rows) as unknown as Parameters<typeof aggregateEntitiesTool>[1];
}

function makeEntity(groupVal: string, numVal?: number) {
  return { attributes: { stage: groupVal, arr: numVal ?? 0 } };
}

describe('aggregateEntitiesTool', () => {
  it('returns error JSON on invalid input', async () => {
    const sql = makeSql();
    const result = await aggregateEntitiesTool({} as Parameters<typeof aggregateEntitiesTool>[0], sql);
    expect(result.isOk()).toBe(true);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(JSON.parse(text)).toHaveProperty('error');
  });

  it('groups entities by attribute and returns count', async () => {
    const rows = [
      makeEntity('lead'),
      makeEntity('lead'),
      makeEntity('prospect'),
    ];
    const sql = makeSql(rows);
    const result = await aggregateEntitiesTool({
      entityType: 'contact',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('lead: count=2');
    expect(text).toContain('prospect: count=1');
  });

  it('sorts groups by count descending (topK applied)', async () => {
    const rows = [
      makeEntity('a'), makeEntity('a'), makeEntity('a'),
      makeEntity('b'), makeEntity('b'),
      makeEntity('c'),
    ];
    const sql = makeSql(rows);
    const result = await aggregateEntitiesTool({
      entityType: 'deal',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      topK: 2,
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    // topK=2: should show 'a' and 'b', not 'c'
    expect(text).toContain('a: count=3');
    expect(text).toContain('b: count=2');
    expect(text).not.toContain('c: count=1');
  });

  it('computes sum and avg for numeric field', async () => {
    const rows = [
      { attributes: { stage: 'open', arr: 100 } },
      { attributes: { stage: 'open', arr: 200 } },
      { attributes: { stage: 'closed', arr: 500 } },
    ];
    const sql = makeSql(rows);
    const result = await aggregateEntitiesTool({
      entityType: 'deal',
      groupByAttribute: 'stage',
      aggregations: ['count', 'sum', 'avg'],
      sumField: 'arr',
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('sum=300.00');
    expect(text).toContain('avg=150.00');
  });

  it('applies key-value filters before aggregating', async () => {
    const rows = [
      { attributes: { stage: 'open', region: 'us' } },
      { attributes: { stage: 'open', region: 'eu' } },
      { attributes: { stage: 'closed', region: 'us' } },
    ];
    const sql = makeSql(rows);
    const result = await aggregateEntitiesTool({
      entityType: 'deal',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      filters: { region: 'us' },
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('open: count=1');
    expect(text).toContain('closed: count=1');
    // eu entity should be filtered out so total counts are different
  });

  it('truncates output when over context budget', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ attributes: { stage: `stage-${i}` } }));
    const sql = makeSql(rows);
    const result = await aggregateEntitiesTool({
      entityType: 'entity',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      topK: 50,
      workspaceId: 'ws-1',
      contextBudget: 100, // tight budget — 50 groups of ~20 chars each (~260 tokens) exceeds 100
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('[truncated]');
  });

  it('returns empty message for zero entities', async () => {
    const sql = makeSql([]);
    const result = await aggregateEntitiesTool({
      entityType: 'contact',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    // groups should be empty, text is just the header
    expect(text).toContain('grouped by stage');
  });

  it('handles DB errors gracefully (returns structured error text)', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('connection lost')) as unknown as Parameters<typeof aggregateEntitiesTool>[1];
    const result = await aggregateEntitiesTool({
      entityType: 'contact',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(JSON.parse(text)).toHaveProperty('error');
  });

  it('computes max and min', async () => {
    const rows = [
      { attributes: { stage: 'open', arr: 100 } },
      { attributes: { stage: 'open', arr: 400 } },
      { attributes: { stage: 'open', arr: 200 } },
    ];
    const sql = makeSql(rows);
    const result = await aggregateEntitiesTool({
      entityType: 'deal',
      groupByAttribute: 'stage',
      aggregations: ['max', 'min'],
      sumField: 'arr',
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('max=400');
    expect(text).toContain('min=100');
  });

  it('groups entities with (none) value for missing attribute', async () => {
    const rows = [
      { attributes: {} },
      { attributes: { stage: 'open' } },
    ];
    const sql = makeSql(rows);
    const result = await aggregateEntitiesTool({
      entityType: 'contact',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('(none): count=1');
    expect(text).toContain('open: count=1');
  });
});
