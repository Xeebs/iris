import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('openai', () => ({
  default: vi.fn(),
  AzureOpenAI: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  })),
}));

import { reciprocalRankFusion, applyRelevanceCutoff } from '../retrieval.js';
import { retrieveContext } from '../retrieval.js';
import type { VectorStore, VectorSearchResult } from '../vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';

function makeEntity(id: string): SemanticEntity {
  return {
    id,
    type: 'contact',
    label: id,
    attributes: {},
    relationships: [],
    lastModified: new Date(),
    sourceId: id,
  };
}

function makeResults(ids: string[]): VectorSearchResult[] {
  return ids.map((id, i) => ({ entity: makeEntity(id), score: 1 - i * 0.1 }));
}

describe('reciprocalRankFusion', () => {
  it('returns empty array for two empty lists', () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });

  it('returns list A items when list B is empty', () => {
    const a = makeResults(['e1', 'e2', 'e3']);
    const result = reciprocalRankFusion(a, []);
    const ids = result.map((r) => r.entity.id);
    expect(ids).toEqual(['e1', 'e2', 'e3']);
  });

  it('returns list B items when list A is empty', () => {
    const b = makeResults(['e4', 'e5']);
    const result = reciprocalRankFusion([], b);
    const ids = result.map((r) => r.entity.id);
    expect(ids).toEqual(['e4', 'e5']);
  });

  it('boosts items ranked highly in both lists', () => {
    // e1 is rank-1 in both lists — should have the highest combined score
    const a = makeResults(['e1', 'e2', 'e3']);
    const b = makeResults(['e1', 'e3', 'e4']);
    const result = reciprocalRankFusion(a, b);
    expect(result[0]!.entity.id).toBe('e1'); // rank-1 in both
  });

  it('combines scores correctly with default k=60', () => {
    const a = [{ entity: makeEntity('e1'), score: 0.9 }];
    const b = [{ entity: makeEntity('e1'), score: 0.8 }];
    const result = reciprocalRankFusion(a, b);
    // e1 rank-1 in A: 1/61, rank-1 in B: 1/61 → total ≈ 0.0328
    expect(result[0]!.score).toBeCloseTo(2 / 61, 5);
  });

  it('produces higher scores with lower k', () => {
    const a = makeResults(['e1']);
    const highK = reciprocalRankFusion(a, [], 100);
    const lowK = reciprocalRankFusion(a, [], 10);
    expect(lowK[0]!.score).toBeGreaterThan(highK[0]!.score);
  });

  it('items present in only one list have lower combined score than items in both', () => {
    const a = makeResults(['shared', 'only-a']);
    const b = makeResults(['shared', 'only-b']);
    const result = reciprocalRankFusion(a, b);
    const sharedScore = result.find((r) => r.entity.id === 'shared')!.score;
    const onlyAScore = result.find((r) => r.entity.id === 'only-a')!.score;
    expect(sharedScore).toBeGreaterThan(onlyAScore);
  });

  it('preserves all unique entities from both lists', () => {
    const a = makeResults(['e1', 'e2']);
    const b = makeResults(['e3', 'e4']);
    const result = reciprocalRankFusion(a, b);
    const ids = new Set(result.map((r) => r.entity.id));
    expect(ids).toContain('e1');
    expect(ids).toContain('e2');
    expect(ids).toContain('e3');
    expect(ids).toContain('e4');
  });

  it('deduplicates entities appearing in both lists', () => {
    const a = makeResults(['e1', 'e2', 'e1']); // duplicate in same list
    const b = makeResults(['e1']);
    const result = reciprocalRankFusion(a, b);
    const e1Count = result.filter((r) => r.entity.id === 'e1').length;
    expect(e1Count).toBe(1);
  });

  it('sorts results by combined score descending', () => {
    const a = makeResults(['e1', 'e2', 'e3', 'e4', 'e5']);
    const b = makeResults(['e3', 'e1', 'e5']);
    const result = reciprocalRankFusion(a, b);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });

  it('handles identical results in both lists', () => {
    const shared = makeResults(['e1', 'e2', 'e3']);
    const result = reciprocalRankFusion(shared, [...shared]);
    expect(result.length).toBe(3);
    expect(result[0]!.entity.id).toBe('e1');
  });

  it('uses custom k value', () => {
    const a = [{ entity: makeEntity('e1'), score: 0.9 }];
    const b = [{ entity: makeEntity('e1'), score: 0.8 }];
    const k = 10;
    const result = reciprocalRankFusion(a, b, k);
    expect(result[0]!.score).toBeCloseTo(2 / (k + 1), 5);
  });
});

describe('retrieveContext hybrid search', () => {
  let savedEmbeddingProvider: string | undefined;

  beforeAll(() => {
    savedEmbeddingProvider = process.env['EMBEDDING_PROVIDER'];
    delete process.env['EMBEDDING_PROVIDER'];
    process.env['AZURE_OPENAI_ENDPOINT'] = 'https://mock.openai.azure.com';
    process.env['AZURE_OPENAI_API_KEY'] = 'mock-key';
  });

  afterAll(() => {
    if (savedEmbeddingProvider !== undefined) {
      process.env['EMBEDDING_PROVIDER'] = savedEmbeddingProvider;
    } else {
      delete process.env['EMBEDDING_PROVIDER'];
    }
    delete process.env['AZURE_OPENAI_ENDPOINT'];
    delete process.env['AZURE_OPENAI_API_KEY'];
  });

  it('calls bm25Search when hybridSearch is true and store supports it', async () => {
    const bm25Search = vi.fn().mockResolvedValue(makeResults(['bm25-1']));
    const mockStore: VectorStore = {
      upsert: vi.fn(),
      search: vi.fn().mockResolvedValue(makeResults(['vec-1', 'vec-2'])),
      delete: vi.fn(),
      listByType: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      bm25Search,
    };

    const result = await retrieveContext('test query', mockStore, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      hybridSearch: true,
    });

    expect(bm25Search).toHaveBeenCalledWith('ws-1', 'test query', 10, undefined);
    expect(result.entities.length).toBeGreaterThan(0);
  });

  it('does not call bm25Search when hybridSearch is false', async () => {
    const bm25Search = vi.fn().mockResolvedValue([]);
    const mockStore: VectorStore = {
      upsert: vi.fn(),
      search: vi.fn().mockResolvedValue(makeResults(['vec-1'])),
      delete: vi.fn(),
      listByType: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      bm25Search,
    };

    await retrieveContext('test query', mockStore, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      hybridSearch: false,
    });

    expect(bm25Search).not.toHaveBeenCalled();
  });

  it('skips bm25Search when store does not implement it', async () => {
    const mockStore: VectorStore = {
      upsert: vi.fn(),
      search: vi.fn().mockResolvedValue(makeResults(['vec-1'])),
      delete: vi.fn(),
      listByType: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      // No bm25Search
    };

    const result = await retrieveContext('test query', mockStore, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      hybridSearch: true,
    });

    expect(result.entities.length).toBeGreaterThan(0);
  });
});

describe('applyRelevanceCutoff', () => {
  const result = (id: string, score: number): VectorSearchResult => ({
    entity: {
      id,
      type: 'deal',
      label: id,
      attributes: {},
      relationships: [],
      lastModified: new Date(0),
      sourceId: id,
    },
    score,
  });

  it('drops results below the relative floor', () => {
    const results = [result('a', 0.9), result('b', 0.5), result('c', 0.4)];
    const kept = applyRelevanceCutoff(results, 0.5);
    expect(kept.map((r) => r.entity.id)).toEqual(['a', 'b']);
  });

  it('always keeps the top result', () => {
    const results = [result('a', 0.9)];
    expect(applyRelevanceCutoff(results, 0.99)).toHaveLength(1);
  });

  it('returns results unchanged when cutoff is 0', () => {
    const results = [result('a', 0.9), result('b', 0.01)];
    expect(applyRelevanceCutoff(results, 0)).toHaveLength(2);
  });

  it('returns results unchanged when the top score is non-positive', () => {
    const results = [result('a', 0), result('b', -0.2)];
    expect(applyRelevanceCutoff(results, 0.5)).toHaveLength(2);
  });

  it('handles an empty list', () => {
    expect(applyRelevanceCutoff([], 0.5)).toEqual([]);
  });
});
