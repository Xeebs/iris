import { describe, it, expect, vi } from 'vitest';
import { compareEntitiesTool } from '../tools/compare-entities.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  return vi.fn().mockResolvedValue(rows) as unknown as Parameters<typeof compareEntitiesTool>[1];
}

function makeRow(id: string, label: string, attrs: Record<string, unknown>) {
  return { entity_id: id, entity_type: 'contact', label, attributes: attrs };
}

describe('compareEntitiesTool', () => {
  it('returns error JSON on invalid input (fewer than 2 entityIds)', async () => {
    const sql = makeSql();
    const result = await compareEntitiesTool(
      { entityIds: ['only-one'], workspaceId: 'ws-1' } as Parameters<typeof compareEntitiesTool>[0],
      sql
    );
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(JSON.parse(text)).toHaveProperty('error');
  });

  it('returns "no entities found" when DB returns empty', async () => {
    const sql = makeSql([]);
    const result = await compareEntitiesTool({
      entityIds: ['e-1', 'e-2'],
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('No entities found');
  });

  it('shows all shared attributes when diffHighlight=false', async () => {
    const rows = [
      makeRow('e-1', 'Alice', { stage: 'lead', arr: 100 }),
      makeRow('e-2', 'Bob', { stage: 'lead', arr: 200 }),
    ];
    const sql = makeSql(rows);
    const result = await compareEntitiesTool({
      entityIds: ['e-1', 'e-2'],
      diffHighlight: false,
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    // both attributes shown even though 'stage' is the same
    expect(text).toContain('stage');
    expect(text).toContain('arr');
  });

  it('hides matching attributes when diffHighlight=true', async () => {
    const rows = [
      makeRow('e-1', 'Alice', { stage: 'lead', region: 'us' }),
      makeRow('e-2', 'Bob', { stage: 'lead', region: 'eu' }),
    ];
    const sql = makeSql(rows);
    const result = await compareEntitiesTool({
      entityIds: ['e-1', 'e-2'],
      diffHighlight: true,
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    // 'region' differs — should appear; 'stage' is same — should be hidden
    expect(text).toContain('region');
    expect(text).not.toMatch(/\bstage\b/);
    expect(text).toContain('matching attributes hidden');
  });

  it('preserves input order of entityIds in output columns', async () => {
    const rows = [
      makeRow('b', 'Bob', { score: 10 }),
      makeRow('a', 'Alice', { score: 99 }),
    ];
    const sql = makeSql(rows);
    const result = await compareEntitiesTool({
      entityIds: ['a', 'b'],
      diffHighlight: false,
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    // 'Alice' should appear before 'Bob' in the header (per input order)
    const alicePos = text.indexOf('Alice');
    const bobPos = text.indexOf('Bob');
    expect(alicePos).toBeLessThan(bobPos);
  });

  it('filters to requested attributes only', async () => {
    const rows = [
      makeRow('e-1', 'Alice', { stage: 'lead', arr: 100, city: 'NYC' }),
      makeRow('e-2', 'Bob', { stage: 'open', arr: 200, city: 'SF' }),
    ];
    const sql = makeSql(rows);
    const result = await compareEntitiesTool({
      entityIds: ['e-1', 'e-2'],
      attributes: ['stage'],
      diffHighlight: false,
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('stage');
    expect(text).not.toContain('arr');
    expect(text).not.toContain('city');
  });

  it('truncates output when over context budget', async () => {
    const attrs: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) attrs[`attr_${i}`] = `value_${i}_something_long`;
    const rows = [
      makeRow('e-1', 'Alpha Entity With Very Long Name', attrs),
      makeRow('e-2', 'Beta Entity With Very Long Name', Object.fromEntries(
        Object.keys(attrs).map((k, i) => [k, `different_value_${i}`])
      )),
    ];
    const sql = makeSql(rows);
    const result = await compareEntitiesTool({
      entityIds: ['e-1', 'e-2'],
      diffHighlight: false,
      workspaceId: 'ws-1',
      contextBudget: 100, // tight budget — 50 differing attrs at ~50 chars each exceeds limit
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('[truncated');
  });

  it('handles DB errors gracefully', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as Parameters<typeof compareEntitiesTool>[1];
    const result = await compareEntitiesTool({
      entityIds: ['e-1', 'e-2'],
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(JSON.parse(text)).toHaveProperty('error');
  });

  it('handles entity not found (partially missing IDs)', async () => {
    const rows = [makeRow('e-1', 'Alice', { stage: 'lead' })];
    const sql = makeSql(rows);
    // only one of the two requested entities exists
    const result = await compareEntitiesTool({
      entityIds: ['e-1', 'missing-id'],
      diffHighlight: false,
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('Alice');
  });

  it('compares 3 entities side-by-side', async () => {
    const rows = [
      makeRow('e-1', 'Alice', { region: 'us', tier: 'gold' }),
      makeRow('e-2', 'Bob', { region: 'eu', tier: 'silver' }),
      makeRow('e-3', 'Carol', { region: 'us', tier: 'bronze' }),
    ];
    const sql = makeSql(rows);
    const result = await compareEntitiesTool({
      entityIds: ['e-1', 'e-2', 'e-3'],
      diffHighlight: false,
      workspaceId: 'ws-1',
      contextBudget: 2000,
    }, sql);
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('Alice');
    expect(text).toContain('Bob');
    expect(text).toContain('Carol');
  });
});
