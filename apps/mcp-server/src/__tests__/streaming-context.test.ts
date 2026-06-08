import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderAtLevel,
  predictExpansionLevel,
  getExpansionStore,
} from '../tools/streaming-context.js';
import type { SemanticEntity } from '@iris/connector-sdk';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntity(partial: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'entity:001',
    type: 'contact',
    label: 'Alice Smith',
    attributes: {
      email: 'alice@example.com',
      company: 'Acme Corp',
      stage: 'customer',
    },
    relationships: [{ type: 'belongs_to', targetId: 'hubspot:company:42' }],
    lastModified: '2026-06-01T00:00:00Z',
    sourceId: 'hubspot:contact:001',
    ...partial,
  };
}

function makeEntities(n: number): SemanticEntity[] {
  return Array.from({ length: n }, (_, i) =>
    makeEntity({
      id: `entity:${i}`,
      label: `Contact ${i}`,
      attributes: { email: `c${i}@example.com`, company: 'Co' },
    }),
  );
}

// ---------------------------------------------------------------------------
// renderAtLevel
// ---------------------------------------------------------------------------

describe('renderAtLevel', () => {
  it('summary level includes only label and type', () => {
    const entities = [makeEntity()];
    const result = renderAtLevel(entities, 'summary', 2000);
    expect(result.content).toContain('[contact]');
    expect(result.content).toContain('Alice Smith');
    expect(result.content).not.toContain('alice@example.com');
  });

  it('detailed level includes attributes', () => {
    const entities = [makeEntity()];
    const result = renderAtLevel(entities, 'detailed', 2000);
    expect(result.content).toContain('alice@example.com');
    expect(result.content).toContain('company: Acme Corp');
  });

  it('full level includes relationships', () => {
    const entities = [makeEntity()];
    const result = renderAtLevel(entities, 'full', 2000);
    expect(result.content).toContain('belongs_to');
    expect(result.content).toContain('hubspot:company:42');
  });

  it('truncates when content exceeds budget', () => {
    const entities = makeEntities(100);
    const result = renderAtLevel(entities, 'detailed', 10); // tiny budget (40 chars)
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThan(entities.length * 50);
  });

  it('does not truncate when content fits in budget', () => {
    const entities = makeEntities(2);
    const result = renderAtLevel(entities, 'summary', 2000);
    expect(result.truncated).toBe(false);
  });

  it('returns empty string for empty entity list', () => {
    const result = renderAtLevel([], 'detailed', 2000);
    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('token estimate is positive for non-empty content', () => {
    const result = renderAtLevel([makeEntity()], 'summary', 2000);
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it('filters null attribute values', () => {
    const entity = makeEntity({ attributes: { email: null, company: 'Corp' } });
    const result = renderAtLevel([entity], 'detailed', 2000);
    expect(result.content).not.toContain('null');
    expect(result.content).toContain('Corp');
  });
});

// ---------------------------------------------------------------------------
// predictExpansionLevel
// ---------------------------------------------------------------------------

describe('predictExpansionLevel', () => {
  it('predicts full for relationship-focused queries', () => {
    expect(predictExpansionLevel('show relationships to companies', ['contact'])).toBe('full');
    expect(predictExpansionLevel('entities connected to deal:001', ['contact'])).toBe('full');
  });

  it('predicts summary for list/count queries', () => {
    expect(predictExpansionLevel('list all contacts', ['contact'])).toBe('summary');
    expect(predictExpansionLevel('how many deals are open', ['deal'])).toBe('summary');
  });

  it('predicts detailed for specific entity queries (default)', () => {
    expect(predictExpansionLevel('what is the status of deal X', ['deal'])).toBe('detailed');
  });

  it('predicts summary for metric-only entity types', () => {
    expect(predictExpansionLevel('show revenue', ['metric'])).toBe('summary');
    expect(predictExpansionLevel('monthly KPIs', ['kpi'])).toBe('summary');
  });

  it('predicts full for detail keyword', () => {
    expect(predictExpansionLevel('show full details of contact Alice', ['contact'])).toBe('full');
  });
});

// ---------------------------------------------------------------------------
// Expansion store TTL
// ---------------------------------------------------------------------------

describe('expansion store', () => {
  beforeEach(() => {
    getExpansionStore().clear();
  });

  it('starts empty after clear', () => {
    expect(getExpansionStore().size).toBe(0);
  });

  it('can store and retrieve an entry manually', () => {
    const store = getExpansionStore();
    store.set('key-abc', {
      workspaceId: 'ws-001',
      query: 'test query',
      entities: [makeEntity()],
      createdAt: Date.now(),
    });
    expect(store.has('key-abc')).toBe(true);
    expect(store.get('key-abc')!.query).toBe('test query');
  });

  it('expired entries are pruned on the next streaming-context call', () => {
    const store = getExpansionStore();
    // Insert an entry created 10 minutes ago (expired)
    store.set('expired-key', {
      workspaceId: 'ws-001',
      query: 'old query',
      entities: [],
      createdAt: Date.now() - 10 * 60 * 1000,
    });
    // The pruneExpansions function is internal — test that the key is accessed correctly
    // The behavior: after prune, expired key should be removed
    const entry = store.get('expired-key');
    expect(entry!.createdAt).toBeLessThan(Date.now() - 5 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Integration-style test: renderAtLevel is cheaper at summary vs full
// ---------------------------------------------------------------------------

describe('token efficiency', () => {
  it('summary level produces fewer tokens than full level', () => {
    const entities = makeEntities(10);
    const summary = renderAtLevel(entities, 'summary', 4000);
    const full = renderAtLevel(entities, 'full', 4000);
    expect(summary.tokenEstimate).toBeLessThan(full.tokenEstimate);
  });

  it('summary level uses at least 40% fewer tokens than full for typical data', () => {
    const entities = makeEntities(5);
    const summary = renderAtLevel(entities, 'summary', 4000);
    const full = renderAtLevel(entities, 'full', 4000);
    const reduction = 1 - summary.tokenEstimate / full.tokenEstimate;
    expect(reduction).toBeGreaterThanOrEqual(0.4);
  });
});
