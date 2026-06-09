import { describe, it, expect, beforeEach } from 'vitest';
import { ContextSearcher } from '../context-searcher.js';
import type { SemanticEntity } from '@iris/connector-sdk';

function makeEntity(type: string, id: string, label: string, attrs: Record<string, unknown>): SemanticEntity {
  return { id, type, label, attributes: attrs, relationships: [], lastModified: new Date().toISOString(), sourceId: id };
}

const SAMPLE_ENTITIES: SemanticEntity[] = [
  makeEntity('contact', 'c1', 'Alice Johnson', { email: 'alice@acme.com', company: 'Acme Corp', role: 'VP Sales' }),
  makeEntity('contact', 'c2', 'Bob Smith', { email: 'bob@corp.com', company: 'Corp Inc', role: 'Engineer' }),
  makeEntity('deal', 'd1', 'Acme Enterprise Deal', { value: 50000, stage: 'negotiation', owner: 'Alice' }),
  makeEntity('deal', 'd2', 'Corp Pilot Deal', { value: 5000, stage: 'proposal', owner: 'Bob' }),
];

// ─── indexMcpResponse / isIndexed ────────────────────────────────────────────

describe('ContextSearcher.indexMcpResponse', () => {
  let searcher: ContextSearcher;
  beforeEach(() => { searcher = new ContextSearcher(); });

  it('indexes entities and marks response as indexed', () => {
    searcher.indexMcpResponse('r-1', 'ws-1', SAMPLE_ENTITIES);
    expect(searcher.isIndexed('r-1')).toBe(true);
  });

  it('evicts expired responses', () => {
    searcher.indexMcpResponse('r-exp', 'ws-1', SAMPLE_ENTITIES, -1); // negative TTL = already expired
    expect(searcher.isIndexed('r-exp')).toBe(false);
  });

  it('returns false for unknown response', () => {
    expect(searcher.isIndexed('non-existent')).toBe(false);
  });
});

// ─── searchWithinContext ──────────────────────────────────────────────────────

describe('ContextSearcher.searchWithinContext', () => {
  let searcher: ContextSearcher;
  beforeEach(() => {
    searcher = new ContextSearcher();
    searcher.indexMcpResponse('r-1', 'ws-1', SAMPLE_ENTITIES);
  });

  it('returns empty for unknown responseId', () => {
    const results = searcher.searchWithinContext('unknown', 'alice');
    expect(results).toHaveLength(0);
  });

  it('finds contact by name', () => {
    const results = searcher.searchWithinContext('r-1', 'alice');
    expect(results.length).toBeGreaterThan(0);
    const entityIds = results.map((r) => r.entity.id);
    expect(entityIds).toContain('c1');
  });

  it('finds entity by company attribute', () => {
    const results = searcher.searchWithinContext('r-1', 'acme');
    expect(results.length).toBeGreaterThan(0);
    const entityIds = results.map((r) => r.entity.id);
    expect(entityIds).toContain('c1');
  });

  it('ranks results by score descending', () => {
    const results = searcher.searchWithinContext('r-1', 'alice acme enterprise');
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
    }
  });

  it('respects limit parameter', () => {
    const results = searcher.searchWithinContext('r-1', 'deal', 1);
    expect(results).toHaveLength(1);
  });

  it('assigns sequential ranks starting at 1', () => {
    const results = searcher.searchWithinContext('r-1', 'deal');
    if (results.length > 0) {
      expect(results[0]!.rank).toBe(1);
    }
  });

  it('includes matching fields in results', () => {
    const results = searcher.searchWithinContext('r-1', 'alice');
    const aliceResult = results.find((r) => r.entity.id === 'c1');
    expect(aliceResult?.matchingFields.length).toBeGreaterThan(0);
  });

  it('returns empty results for no-match query', () => {
    const results = searcher.searchWithinContext('r-1', 'xyzquux999');
    expect(results).toHaveLength(0);
  });
});

// ─── explainMatch ─────────────────────────────────────────────────────────────

describe('ContextSearcher.explainMatch', () => {
  let searcher: ContextSearcher;
  beforeEach(() => {
    searcher = new ContextSearcher();
    searcher.indexMcpResponse('r-1', 'ws-1', SAMPLE_ENTITIES);
  });

  it('returns null for unknown responseId', () => {
    expect(searcher.explainMatch('unknown', 'c1', 'alice')).toBeNull();
  });

  it('returns null for unknown entityId', () => {
    expect(searcher.explainMatch('r-1', 'non-existent', 'alice')).toBeNull();
  });

  it('explains match with matching fields', () => {
    const result = searcher.explainMatch('r-1', 'c1', 'alice');
    expect(result).not.toBeNull();
    expect(result!.matchingFields.length).toBeGreaterThan(0);
    expect(result!.entityId).toBe('c1');
  });

  it('includes score and reason in explanation', () => {
    const result = searcher.explainMatch('r-1', 'c1', 'alice acme vp');
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.reason.length).toBeGreaterThan(5);
  });
});

// ─── evict / getIndexStats ────────────────────────────────────────────────────

describe('ContextSearcher misc', () => {
  let searcher: ContextSearcher;
  beforeEach(() => { searcher = new ContextSearcher(); });

  it('evicts a response from the index', () => {
    searcher.indexMcpResponse('r-del', 'ws-1', SAMPLE_ENTITIES);
    expect(searcher.isIndexed('r-del')).toBe(true);
    expect(searcher.evict('r-del')).toBe(true);
    expect(searcher.isIndexed('r-del')).toBe(false);
  });

  it('evict returns false for non-existent response', () => {
    expect(searcher.evict('ghost')).toBe(false);
  });

  it('getIndexStats returns entity and response counts', () => {
    searcher.indexMcpResponse('r-a', 'ws-1', SAMPLE_ENTITIES);
    const stats = searcher.getIndexStats();
    expect(stats.totalResponses).toBe(1);
    expect(stats.totalEntities).toBe(4);
  });
});
