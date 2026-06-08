import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EntityDeduplicator,
  evaluateCondition,
  attributeOverlapRatio,
} from '../entity-deduplicator.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import type postgres from 'postgres';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []): ReturnType<typeof postgres> {
  return vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof postgres>;
}

function makeEntity(id: string, attrs: Record<string, unknown> = {}): SemanticEntity {
  return {
    id,
    type: 'contact',
    label: `Entity ${id}`,
    attributes: attrs as SemanticEntity['attributes'],
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: id,
  };
}

// ─── evaluateCondition ───────────────────────────────────────────────────────

describe('evaluateCondition — exact', () => {
  it('returns true for matching field values (case-insensitive)', () => {
    const a = makeEntity('a', { email: 'Alice@Example.com' });
    const b = makeEntity('b', { email: 'alice@example.com' });
    expect(evaluateCondition(a, b, { type: 'exact', field: 'email' })).toBe(true);
  });

  it('returns false for non-matching values', () => {
    const a = makeEntity('a', { email: 'alice@x.com' });
    const b = makeEntity('b', { email: 'bob@x.com' });
    expect(evaluateCondition(a, b, { type: 'exact', field: 'email' })).toBe(false);
  });

  it('returns false when field is missing in one entity', () => {
    const a = makeEntity('a', { email: 'alice@x.com' });
    const b = makeEntity('b', {});
    expect(evaluateCondition(a, b, { type: 'exact', field: 'email' })).toBe(false);
  });

  it('respects caseInsensitive=false', () => {
    const a = makeEntity('a', { code: 'ABC' });
    const b = makeEntity('b', { code: 'abc' });
    expect(evaluateCondition(a, b, { type: 'exact', field: 'code', caseInsensitive: false })).toBe(false);
    expect(evaluateCondition(a, b, { type: 'exact', field: 'code', caseInsensitive: true })).toBe(true);
  });
});

describe('evaluateCondition — fuzzy', () => {
  it('returns true for strings within default distance threshold', () => {
    const a = makeEntity('a', { name: 'Alice Smith' });
    const b = makeEntity('b', { name: 'Alice Smyth' });
    expect(evaluateCondition(a, b, { type: 'fuzzy', field: 'name' })).toBe(true);
  });

  it('returns false for strings exceeding the threshold', () => {
    const a = makeEntity('a', { name: 'Alice' });
    const b = makeEntity('b', { name: 'Bob' });
    expect(evaluateCondition(a, b, { type: 'fuzzy', field: 'name', maxNormalizedDistance: 0.2 })).toBe(false);
  });

  it('returns true for identical strings', () => {
    const a = makeEntity('a', { name: 'Test' });
    const b = makeEntity('b', { name: 'Test' });
    expect(evaluateCondition(a, b, { type: 'fuzzy', field: 'name' })).toBe(true);
  });

  it('returns false when field is absent', () => {
    const a = makeEntity('a', {});
    const b = makeEntity('b', { name: 'Bob' });
    expect(evaluateCondition(a, b, { type: 'fuzzy', field: 'name' })).toBe(false);
  });
});

describe('evaluateCondition — composite', () => {
  it('AND returns true when both conditions match', () => {
    const a = makeEntity('a', { email: 'a@x.com', name: 'Alice Smith' });
    const b = makeEntity('b', { email: 'a@x.com', name: 'Alice Smyth' });
    expect(evaluateCondition(a, b, {
      type: 'composite',
      operator: 'AND',
      conditions: [
        { type: 'exact', field: 'email' },
        { type: 'fuzzy', field: 'name' },
      ],
    })).toBe(true);
  });

  it('AND returns false when any condition fails', () => {
    const a = makeEntity('a', { email: 'a@x.com', name: 'Alice' });
    const b = makeEntity('b', { email: 'b@x.com', name: 'Alice' });
    expect(evaluateCondition(a, b, {
      type: 'composite',
      operator: 'AND',
      conditions: [
        { type: 'exact', field: 'email' },
        { type: 'exact', field: 'name' },
      ],
    })).toBe(false);
  });

  it('OR returns true when any condition matches', () => {
    const a = makeEntity('a', { email: 'a@x.com', name: 'Alice' });
    const b = makeEntity('b', { email: 'b@x.com', name: 'Alice' });
    expect(evaluateCondition(a, b, {
      type: 'composite',
      operator: 'OR',
      conditions: [
        { type: 'exact', field: 'email' },
        { type: 'exact', field: 'name' },
      ],
    })).toBe(true);
  });

  it('OR returns false when no conditions match', () => {
    const a = makeEntity('a', { email: 'a@x.com', name: 'Alice' });
    const b = makeEntity('b', { email: 'b@x.com', name: 'Bob' });
    expect(evaluateCondition(a, b, {
      type: 'composite',
      operator: 'OR',
      conditions: [
        { type: 'exact', field: 'email' },
        { type: 'exact', field: 'name' },
      ],
    })).toBe(false);
  });

  it('supports nested composite (AND within OR)', () => {
    const a = makeEntity('a', { email: 'a@x.com', domain: 'x.com', tag: 'vip' });
    const b = makeEntity('b', { email: 'a@x.com', domain: 'x.com', tag: 'regular' });
    expect(evaluateCondition(a, b, {
      type: 'composite',
      operator: 'OR',
      conditions: [
        { type: 'exact', field: 'tag' },  // fails
        {
          type: 'composite',
          operator: 'AND',
          conditions: [
            { type: 'exact', field: 'email' },
            { type: 'exact', field: 'domain' },
          ],
        },
      ],
    })).toBe(true);
  });
});

// ─── attributeOverlapRatio ────────────────────────────────────────────────────

describe('attributeOverlapRatio', () => {
  it('returns 1 when all non-null attrs match', () => {
    const a = makeEntity('a', { email: 'a@x.com', name: 'Alice' });
    const b = makeEntity('b', { email: 'a@x.com', name: 'Alice' });
    expect(attributeOverlapRatio(a, b)).toBe(1);
  });

  it('returns 0 when no attrs match', () => {
    const a = makeEntity('a', { email: 'a@x.com' });
    const b = makeEntity('b', { email: 'b@x.com' });
    expect(attributeOverlapRatio(a, b)).toBe(0);
  });

  it('returns 0 when both entities have no attrs', () => {
    expect(attributeOverlapRatio(makeEntity('a'), makeEntity('b'))).toBe(0);
  });

  it('returns partial overlap for partial match', () => {
    const a = makeEntity('a', { email: 'a@x.com', name: 'Alice', org: 'Acme' });
    const b = makeEntity('b', { email: 'a@x.com', name: 'Alice', org: 'Beta' });
    const ratio = attributeOverlapRatio(a, b);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });
});

// ─── EntityDeduplicator ──────────────────────────────────────────────────────

describe('EntityDeduplicator.defineDeduplicationRules', () => {
  it('inserts rules and returns IDs', async () => {
    const sql = makeSql([{ id: 'rule-1' }]);
    const deduplicator = new EntityDeduplicator(sql);
    const ids = await deduplicator.defineDeduplicationRules('ws-1', 'contact', [
      { name: 'Email match', condition: { type: 'exact', field: 'email' } },
    ]);
    expect(ids).toContain('rule-1');
    expect(sql).toHaveBeenCalled();
  });

  it('inserts multiple rules and returns all IDs', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ id: 'r1' }])
      .mockResolvedValueOnce([{ id: 'r2' }]) as unknown as ReturnType<typeof postgres>;
    const deduplicator = new EntityDeduplicator(sql);
    const ids = await deduplicator.defineDeduplicationRules('ws-1', 'contact', [
      { name: 'Email', condition: { type: 'exact', field: 'email' } },
      { name: 'Phone', condition: { type: 'exact', field: 'phone' } },
    ]);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(['r1', 'r2']);
  });
});

describe('EntityDeduplicator.getRules', () => {
  it('returns mapped rules from DB', async () => {
    const sql = makeSql([{
      id: 'r1', name: 'Email match', entity_type: 'contact',
      condition_json: { type: 'exact', field: 'email' },
      confidence: 'high', enabled_at: new Date(),
    }]);
    const deduplicator = new EntityDeduplicator(sql);
    const rules = await deduplicator.getRules('ws-1', 'contact');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('r1');
    expect(rules[0]?.condition).toEqual({ type: 'exact', field: 'email' });
  });

  it('returns empty array when no rules exist', async () => {
    const deduplicator = new EntityDeduplicator(makeSql([]));
    const rules = await deduplicator.getRules('ws-1', 'contact');
    expect(rules).toHaveLength(0);
  });
});

describe('EntityDeduplicator.applyRules', () => {
  it('returns empty array when no rules exist in DB', async () => {
    const sql = makeSql([]);
    const deduplicator = new EntityDeduplicator(sql);
    const entities = [
      makeEntity('a', { email: 'a@x.com' }),
      makeEntity('b', { email: 'a@x.com' }),
    ];
    const groups = await deduplicator.applyRules(entities, 'contact', 'ws-1');
    expect(groups).toHaveLength(0);
  });

  it('returns empty when fewer than 2 entities', async () => {
    const sql = makeSql([{ id: 'r1', name: 'Email', entity_type: 'contact', condition_json: { type: 'exact', field: 'email' }, confidence: 'high', enabled_at: new Date() }]);
    const deduplicator = new EntityDeduplicator(sql);
    const groups = await deduplicator.applyRules([makeEntity('a', { email: 'a@x.com' })], 'contact', 'ws-1');
    expect(groups).toHaveLength(0);
  });

  it('groups entities matched by rules', async () => {
    const ruleRow = { id: 'r1', name: 'Email match', entity_type: 'contact', condition_json: { type: 'exact', field: 'email' }, confidence: 'high', enabled_at: new Date() };
    const sql = makeSql([ruleRow]);
    const deduplicator = new EntityDeduplicator(sql);
    const a = makeEntity('a', { email: 'shared@x.com' });
    const b = makeEntity('b', { email: 'shared@x.com' });
    const c = makeEntity('c', { email: 'other@x.com' });
    const groups = await deduplicator.applyRules([a, b, c], 'contact', 'ws-1');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.canonical.id).toBe('a');
    expect(groups[0]?.duplicates.map((d) => d.id)).toContain('b');
    expect(groups[0]?.duplicates.map((d) => d.id)).not.toContain('c');
  });

  it('does not include already-grouped entities in multiple groups', async () => {
    const ruleRow = { id: 'r1', name: 'Email', entity_type: 'contact', condition_json: { type: 'exact', field: 'email' }, confidence: 'medium', enabled_at: new Date() };
    const sql = makeSql([ruleRow]);
    const deduplicator = new EntityDeduplicator(sql);
    const a = makeEntity('a', { email: 'shared@x.com' });
    const b = makeEntity('b', { email: 'shared@x.com' });
    const c = makeEntity('c', { email: 'shared@x.com' });
    const groups = await deduplicator.applyRules([a, b, c], 'contact', 'ws-1');
    const canonicalIds = groups.map((g) => g.canonical.id);
    const allIds = groups.flatMap((g) => [g.canonical.id, ...g.duplicates.map((d) => d.id)]);
    expect(new Set(allIds).size).toBe(allIds.length); // no duplicates across groups
    expect(canonicalIds).not.toContain('b'); // b and c grouped under a
  });
});

describe('EntityDeduplicator.scoreCandidate', () => {
  it('returns 0 score when no rules fire and no embeddings', () => {
    const sql = makeSql([]);
    const deduplicator = new EntityDeduplicator(sql);
    const a = makeEntity('a', { email: 'a@x.com' });
    const b = makeEntity('b', { email: 'b@x.com' });
    const rules = [{ id: 'r1', name: 'Email', entityType: 'contact', condition: { type: 'exact' as const, field: 'email' } }];
    const result = deduplicator.scoreCandidate(a, b, rules);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.firedRules).toHaveLength(0);
  });

  it('includes fired rule IDs in result', () => {
    const sql = makeSql([]);
    const deduplicator = new EntityDeduplicator(sql);
    const a = makeEntity('a', { email: 'same@x.com' });
    const b = makeEntity('b', { email: 'same@x.com' });
    const rules = [{ id: 'r1', name: 'Email', entityType: 'contact', condition: { type: 'exact' as const, field: 'email' } }];
    const result = deduplicator.scoreCandidate(a, b, rules);
    expect(result.firedRules).toContain('r1');
  });

  it('uses embedding cosine similarity when vectors provided', () => {
    const deduplicator = new EntityDeduplicator(makeSql([]));
    const a = makeEntity('a', {});
    const b = makeEntity('b', {});
    const v = Array.from({ length: 3 }, (_, i) => (i === 0 ? 1 : 0));
    const result = deduplicator.scoreCandidate(a, b, [], { v1: v, v2: v });
    expect(result.embeddingWeight).toBeCloseTo(1);
    expect(result.score).toBeGreaterThan(0.4);
  });

  it('score is bounded to [0, 1]', () => {
    const deduplicator = new EntityDeduplicator(makeSql([]));
    const a = makeEntity('a', { email: 'x@y.com', name: 'Test' });
    const b = makeEntity('b', { email: 'x@y.com', name: 'Test' });
    const rules = [
      { id: 'r1', name: 'Email', entityType: 'contact', condition: { type: 'exact' as const, field: 'email' } },
      { id: 'r2', name: 'Name', entityType: 'contact', condition: { type: 'exact' as const, field: 'name' } },
    ];
    const v = Array.from({ length: 3 }, (_, i) => (i === 0 ? 1 : 0));
    const result = deduplicator.scoreCandidate(a, b, rules, { v1: v, v2: v });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe('EntityDeduplicator.previewRules', () => {
  it('returns groups without DB interaction', () => {
    const deduplicator = new EntityDeduplicator(makeSql([]));
    const a = makeEntity('a', { email: 'same@x.com' });
    const b = makeEntity('b', { email: 'same@x.com' });
    const c = makeEntity('c', { email: 'different@x.com' });
    const groups = deduplicator.previewRules([a, b, c], [
      { name: 'Email match', entityType: 'contact', condition: { type: 'exact', field: 'email' } },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.duplicates).toHaveLength(1);
  });

  it('returns empty for fewer than 2 entities', () => {
    const deduplicator = new EntityDeduplicator(makeSql([]));
    const groups = deduplicator.previewRules(
      [makeEntity('a', { email: 'x@y.com' })],
      [{ name: 'Email', entityType: 'contact', condition: { type: 'exact', field: 'email' } }],
    );
    expect(groups).toHaveLength(0);
  });

  it('returns empty when no rules provided', () => {
    const deduplicator = new EntityDeduplicator(makeSql([]));
    const groups = deduplicator.previewRules(
      [makeEntity('a', { email: 'x@y.com' }), makeEntity('b', { email: 'x@y.com' })],
      [],
    );
    expect(groups).toHaveLength(0);
  });
});
