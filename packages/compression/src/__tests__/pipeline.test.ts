import { describe, it, expect } from 'vitest';
import type { SemanticEntity } from '@iris/connector-sdk';

import { compress, compressContext, DEFAULT_COMPRESSION_OPTIONS } from '../pipeline.js';
import { dedup } from '../stages/dedup.js';
import { truncate, estimateEntityTokens } from '../stages/truncate.js';
import { serialize, serializeEntity } from '../stages/serialize.js';

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'hubspot:contact:1',
    type: 'contact',
    label: 'Alice Smith',
    attributes: { email: 'alice@example.com', stage: 'lead' },
    relationships: [],
    lastModified: new Date('2024-01-01'),
    sourceId: 'hubspot:contact:1',
    ...overrides,
  };
}

// ─── dedup ──────────────────────────────────────────────────────────────────

describe('dedup()', () => {
  it('returns empty array for empty input', () => {
    expect(dedup([])).toEqual([]);
  });

  it('removes duplicate IDs, keeping first occurrence', () => {
    const a = makeEntity({ id: 'a', label: 'First A' });
    const b = makeEntity({ id: 'b', label: 'B' });
    const a2 = makeEntity({ id: 'a', label: 'Second A' });
    const result = dedup([a, b, a2]);
    expect(result).toHaveLength(2);
    expect(result[0]?.label).toBe('First A');
    expect(result[1]?.label).toBe('B');
  });

  it('preserves order of unique entities', () => {
    const entities = ['x', 'y', 'z'].map((id) => makeEntity({ id }));
    expect(dedup(entities).map((e) => e.id)).toEqual(['x', 'y', 'z']);
  });
});

// ─── serialize ───────────────────────────────────────────────────────────────

describe('serializeEntity()', () => {
  it('renders type, label, and attributes', () => {
    const entity = makeEntity();
    const out = serializeEntity(entity);
    expect(out).toContain('[contact]');
    expect(out).toContain('Alice Smith');
    expect(out).toContain('email: alice@example.com');
    expect(out).toContain('stage: lead');
  });

  it('omits null attributes', () => {
    const entity = makeEntity({ attributes: { email: null, stage: 'lead' } });
    const out = serializeEntity(entity);
    expect(out).not.toContain('email');
    expect(out).toContain('stage: lead');
  });

  it('includes relationships when present', () => {
    const entity = makeEntity({
      relationships: [{ type: 'belongs_to', targetId: 'hubspot:company:99' }],
    });
    const out = serializeEntity(entity);
    expect(out).toContain('relations:');
    expect(out).toContain('belongs_to→hubspot:company:99');
  });

  it('omits relationships block when empty', () => {
    const entity = makeEntity({ relationships: [] });
    expect(serializeEntity(entity)).not.toContain('relations:');
  });
});

describe('serialize()', () => {
  it('joins multiple entities with double newline', () => {
    const a = makeEntity({ id: 'a', label: 'A' });
    const b = makeEntity({ id: 'b', label: 'B' });
    const out = serialize([a, b]);
    expect(out).toContain('\n\n');
  });

  it('returns empty string for empty input', () => {
    expect(serialize([])).toBe('');
  });
});

// ─── truncate ────────────────────────────────────────────────────────────────

describe('truncate()', () => {
  it('returns empty array when budget is 0', () => {
    const entities = [makeEntity()];
    expect(truncate(entities, 0)).toEqual([]);
  });

  it('returns all entities when they fit within budget', () => {
    const entities = [makeEntity({ id: 'a' }), makeEntity({ id: 'b' })];
    const result = truncate(entities, 10_000);
    expect(result).toHaveLength(2);
  });

  it('drops entities that would exceed the budget', () => {
    // Each entity serializes to roughly 60–80 chars (~15–20 tokens)
    // Set budget to 10 tokens — should only fit 0 entities
    const entities = Array.from({ length: 5 }, (_, i) =>
      makeEntity({ id: String(i), label: `Entity ${i}` }),
    );
    const result = truncate(entities, 10);
    expect(result.length).toBeLessThan(5);
  });

  it('keeps first entities and drops later ones', () => {
    const entities = ['a', 'b', 'c', 'd', 'e'].map((id) => makeEntity({ id }));
    const budget = estimateEntityTokens(entities[0]!) * 2 + 1;
    const result = truncate(entities, budget);
    expect(result.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

// ─── compress / compressContext ───────────────────────────────────────────────

describe('compress()', () => {
  it('returns empty content for empty input', () => {
    const result = compress([]);
    expect(result.content).toBe('');
    expect(result.entityCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.savedTokens).toBe(0);
  });

  it('deduplicates before truncating', () => {
    const dup = makeEntity({ id: 'same' });
    const result = compress([dup, dup, dup], { contextBudget: 10_000 });
    expect(result.entityCount).toBe(1);
  });

  it('sets truncated=true when entities are dropped to fit budget', () => {
    const entities = Array.from({ length: 100 }, (_, i) =>
      makeEntity({ id: String(i), label: `Entity number ${i} with some extra text` }),
    );
    const result = compress(entities, { contextBudget: 50 });
    expect(result.truncated).toBe(true);
    expect(result.entityCount).toBeLessThan(100);
    expect(result.savedTokens).toBeGreaterThan(0);
  });

  it('respects DEFAULT_COMPRESSION_OPTIONS defaults', () => {
    expect(DEFAULT_COMPRESSION_OPTIONS.contextBudget).toBe(2000);
  });

  it('tokenCount does not exceed contextBudget', () => {
    const entities = Array.from({ length: 200 }, (_, i) =>
      makeEntity({ id: String(i), label: `Entity ${i}` }),
    );
    const result = compress(entities, { contextBudget: 300 });
    expect(result.tokenCount).toBeLessThanOrEqual(300);
  });
});

describe('compressContext()', () => {
  it('returns the same result as compress()', async () => {
    const entities = [makeEntity({ id: 'a' }), makeEntity({ id: 'b' })];
    const sync = compress(entities);
    const async_ = await compressContext(entities);
    expect(async_).toEqual(sync);
  });
});
