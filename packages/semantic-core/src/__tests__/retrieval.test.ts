import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retrieveContext, reciprocalRankFusion } from '../retrieval.js';
import type { VectorStore, VectorSearchResult } from '../vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import { ok, err } from 'neverthrow';
import { AzureOpenAI } from 'openai';

vi.mock('openai', () => ({
  default: vi.fn(),
  AzureOpenAI: vi.fn(),
}));

vi.mock('../query-decomposer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../query-decomposer.js')>();
  return { ...actual, expandQuery: vi.fn().mockImplementation(async (q: string) => q) };
});

import { expandQuery } from '../query-decomposer.js';

function makeEntity(
  id: string,
  type = 'contact',
  relationships: SemanticEntity['relationships'] = [],
): SemanticEntity {
  return {
    id,
    type,
    label: `Entity ${id}`,
    attributes: { company: 'Acme' },
    relationships,
    lastModified: new Date('2026-01-01'),
    sourceId: id,
  };
}

function makeMockVectorStore(
  results: Array<{ entity: SemanticEntity; score: number }> = [],
): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(results),
    delete: vi.fn().mockResolvedValue(undefined),
    listByType: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
  };
}

function makeMockGraphStore(related: Array<{ id: string; type: string; label: string; relationshipType: string; workspaceId: string }> = []) {
  return {
    getRelated: vi.fn().mockResolvedValue(ok(related)),
  };
}

const mockQueryVector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));

describe('retrieveContext', () => {
  const mockCreate = vi.fn();
  let savedEmbeddingProvider: string | undefined;

  beforeEach(() => {
    // Isolate from EMBEDDING_PROVIDER in .env.local — tests rely on the Azure mock path
    savedEmbeddingProvider = process.env['EMBEDDING_PROVIDER'];
    delete process.env['EMBEDDING_PROVIDER'];
    process.env['AZURE_OPENAI_ENDPOINT'] = 'https://test.openai.azure.com';
    process.env['AZURE_OPENAI_API_KEY'] = 'test-key';
    vi.mocked(AzureOpenAI).mockImplementation(
      () => ({ embeddings: { create: mockCreate } }) as unknown as AzureOpenAI,
    );
    mockCreate.mockResolvedValue({
      data: [{ index: 0, embedding: mockQueryVector }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
  });

  afterEach(() => {
    if (savedEmbeddingProvider !== undefined) {
      process.env['EMBEDDING_PROVIDER'] = savedEmbeddingProvider;
    } else {
      delete process.env['EMBEDDING_PROVIDER'];
    }
    delete process.env['AZURE_OPENAI_ENDPOINT'];
    delete process.env['AZURE_OPENAI_API_KEY'];
    vi.clearAllMocks();
  });

  it('returns entities from vector search', async () => {
    const entity = makeEntity('hubspot:contact:1');
    const store = makeMockVectorStore([{ entity, score: 0.9 }]);

    const result = await retrieveContext('show me contacts', store, {
      workspaceId: 'ws-1',
      topK: 10,
      expandRelationships: false,
      maxDepth: 0,
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.id).toBe('hubspot:contact:1');
    expect(result.scores[0]).toBe(0.9);
    expect(result.fromCache).toBe(false);
  });

  it('calls embedQuery once per request', async () => {
    const store = makeMockVectorStore([]);
    await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
    });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('passes workspaceId to vector search filter', async () => {
    const store = makeMockVectorStore([]);
    await retrieveContext('query', store, {
      workspaceId: 'ws-42',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
    });
    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      5,
      expect.objectContaining({ workspaceId: 'ws-42' }),
    );
  });

  it('passes entityTypes filter when specified', async () => {
    const store = makeMockVectorStore([]);
    await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      entityTypes: ['deal'],
      expandRelationships: false,
      maxDepth: 0,
    });
    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      5,
      expect.objectContaining({ entityTypes: ['deal'] }),
    );
  });

  it('expands related entities via entity.relationships (fallback path)', async () => {
    const company = makeEntity('hubspot:company:2');
    const contact = makeEntity('hubspot:contact:1', 'contact', [
      { type: 'belongs_to', targetId: 'hubspot:company:2' },
    ]);

    const store = makeMockVectorStore([{ entity: contact, score: 0.9 }]);
    vi.mocked(store.getById).mockResolvedValue(company);

    const result = await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: true,
      maxDepth: 1,
    });

    expect(result.entities).toHaveLength(2);
    const ids = result.entities.map((e) => e.id);
    expect(ids).toContain('hubspot:contact:1');
    expect(ids).toContain('hubspot:company:2');
    // Contact is emitted first, then its referenced company immediately after (interleaved)
    expect(ids[0]).toBe('hubspot:contact:1');
    expect(ids[1]).toBe('hubspot:company:2');
  });

  it('interleaves reverse-expanded entities immediately after their parent', async () => {
    const company = makeEntity('hubspot:company:1', 'company');
    const contact1 = makeEntity('hubspot:contact:10', 'contact');
    const contact2 = makeEntity('hubspot:contact:11', 'contact');
    const otherCompany = makeEntity('hubspot:company:2', 'company');

    const store: VectorStore = {
      ...makeMockVectorStore([
        { entity: company, score: 0.95 },
        { entity: otherCompany, score: 0.7 },
      ]),
      getByRelationshipTarget: vi.fn().mockImplementation((_ws: string, targetId: string) => {
        if (targetId === 'hubspot:company:1') return Promise.resolve([contact1, contact2]);
        return Promise.resolve([]);
      }),
    };

    const result = await retrieveContext('contacts at Acme Corp', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: true,
      maxDepth: 1,
    });

    const ids = result.entities.map((e) => e.id);
    // company:1 first, then its contacts immediately after, then otherCompany
    expect(ids[0]).toBe('hubspot:company:1');
    expect(ids[1]).toBe('hubspot:contact:10');
    expect(ids[2]).toBe('hubspot:contact:11');
    expect(ids[3]).toBe('hubspot:company:2');
    expect(result.entities).toHaveLength(4);
  });

  it('expands related entities via graphStore when provided', async () => {
    const contact = makeEntity('hubspot:contact:1');
    const company = makeEntity('hubspot:company:2');

    const store = makeMockVectorStore([{ entity: contact, score: 0.9 }]);
    vi.mocked(store.getById).mockResolvedValue(company);

    const graphStore = makeMockGraphStore([
      { id: 'hubspot:company:2', type: 'company', label: 'Acme Corp', relationshipType: 'belongs_to', workspaceId: 'ws-1' },
    ]);

    const result = await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: true,
      maxDepth: 1,
      graphStore,
    });

    expect(graphStore.getRelated).toHaveBeenCalledWith('hubspot:contact:1', 'ws-1');
    expect(result.entities).toHaveLength(2);
    expect(result.entities.map((e) => e.id)).toContain('hubspot:company:2');
  });

  it('assigns a discounted score (0.5) to graph-expanded entities', async () => {
    const contact = makeEntity('hubspot:contact:1');
    const company = makeEntity('hubspot:company:2');

    const store = makeMockVectorStore([{ entity: contact, score: 0.95 }]);
    vi.mocked(store.getById).mockResolvedValue(company);

    const graphStore = makeMockGraphStore([
      { id: 'hubspot:company:2', type: 'company', label: 'Acme', relationshipType: 'belongs_to', workspaceId: 'ws-1' },
    ]);

    const result = await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: true,
      maxDepth: 1,
      graphStore,
    });

    const companyScore = result.scores[result.entities.findIndex((e) => e.id === 'hubspot:company:2')];
    expect(companyScore).toBe(0.5);
  });

  it('does not add duplicate entities during graph expansion', async () => {
    const contact = makeEntity('hubspot:contact:1');

    const store = makeMockVectorStore([{ entity: contact, score: 0.9 }]);
    const graphStore = makeMockGraphStore([
      // The same entity is returned by the graph store
      { id: 'hubspot:contact:1', type: 'contact', label: 'Alice', relationshipType: 'self', workspaceId: 'ws-1' },
    ]);

    const result = await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: true,
      maxDepth: 1,
      graphStore,
    });

    expect(result.entities).toHaveLength(1);
  });

  it('handles graphStore.getRelated error gracefully', async () => {
    const contact = makeEntity('hubspot:contact:1');
    const store = makeMockVectorStore([{ entity: contact, score: 0.9 }]);
    const graphStore = { getRelated: vi.fn().mockResolvedValue(err(new Error('neo4j down'))) };

    const result = await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: true,
      maxDepth: 1,
      graphStore,
    });

    // Should still return the primary search results
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.id).toBe('hubspot:contact:1');
  });

  it('does not expand when expandRelationships=false', async () => {
    const contact = makeEntity('hubspot:contact:1', 'contact', [
      { type: 'belongs_to', targetId: 'hubspot:company:2' },
    ]);
    const store = makeMockVectorStore([{ entity: contact, score: 0.9 }]);
    const graphStore = makeMockGraphStore([]);

    const result = await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      graphStore,
    });

    expect(result.entities).toHaveLength(1);
    expect(graphStore.getRelated).not.toHaveBeenCalled();
  });

  it('throws IndexerError when embedding fails', async () => {
    mockCreate.mockRejectedValue(new Error('OpenAI down'));
    const store = makeMockVectorStore([]);

    await expect(
      retrieveContext('query', store, {
        workspaceId: 'ws-1',
        topK: 5,
        expandRelationships: false,
        maxDepth: 0,
      }),
    ).rejects.toMatchObject({ code: 'INDEXER_ERROR' });
  });

  it('records timing fields in result', async () => {
    const store = makeMockVectorStore([]);
    const result = await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
    });

    expect(result.queryEmbeddingMs).toBeGreaterThanOrEqual(0);
    expect(result.vectorSearchMs).toBeGreaterThanOrEqual(0);
    expect(result.graphExpansionMs).toBeGreaterThanOrEqual(0);
  });

  it('uses hybrid search when vectorStore supports bm25Search', async () => {
    const entity1 = makeEntity('hubspot:contact:1');
    const entity2 = makeEntity('hubspot:contact:2');
    const store = makeMockVectorStore([{ entity: entity1, score: 0.9 }]);
    const bm25Mock = vi.fn().mockResolvedValue([{ entity: entity2, score: 0.8 }]);
    (store as VectorStore & { bm25Search: typeof bm25Mock }).bm25Search = bm25Mock;

    const result = await retrieveContext('find contacts', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      hybridSearch: true,
    });

    expect(bm25Mock).toHaveBeenCalledOnce();
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('skips BM25 when hybridSearch=false', async () => {
    const entity = makeEntity('hubspot:contact:1');
    const store = makeMockVectorStore([{ entity, score: 0.9 }]);
    const bm25Mock = vi.fn().mockResolvedValue([]);
    (store as VectorStore & { bm25Search: typeof bm25Mock }).bm25Search = bm25Mock;

    await retrieveContext('find contacts', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      hybridSearch: false,
    });

    expect(bm25Mock).not.toHaveBeenCalled();
  });

  it('falls back to vector-only when bm25Search not available', async () => {
    const entity = makeEntity('hubspot:contact:1');
    const store = makeMockVectorStore([{ entity, score: 0.9 }]);
    // No bm25Search on the store

    const result = await retrieveContext('find contacts', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      hybridSearch: true, // requested, but store doesn't support it
    });

    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      5,
      expect.any(Object),
    );
    expect(result.entities).toHaveLength(1);
  });
});

describe('reciprocalRankFusion', () => {
  function makeResult(id: string, score = 0.5): VectorSearchResult {
    return {
      entity: makeEntity(id),
      score,
    };
  }

  it('returns empty array when both lists are empty', () => {
    const result = reciprocalRankFusion([], []);
    expect(result).toEqual([]);
  });

  it('passes through list A when list B is empty', () => {
    const a = [makeResult('e1', 0.9), makeResult('e2', 0.7)];
    const result = reciprocalRankFusion(a, []);
    expect(result).toHaveLength(2);
    expect(result[0]!.entity.id).toBe('e1');
  });

  it('passes through list B when list A is empty', () => {
    const b = [makeResult('e3', 0.8)];
    const result = reciprocalRankFusion([], b);
    expect(result).toHaveLength(1);
    expect(result[0]!.entity.id).toBe('e3');
  });

  it('boosts entity that appears in both lists', () => {
    // e1 ranks first in vector, e2 ranks first in BM25; e1 also appears second in BM25
    const vectorList = [makeResult('e1', 0.9), makeResult('e2', 0.7)];
    const bm25List = [makeResult('e2', 0.8), makeResult('e1', 0.5)];
    const result = reciprocalRankFusion(vectorList, bm25List);
    // e1 appears at rank 1 in vector (score=1/61) and rank 2 in bm25 (score=1/62): total ≈ 0.0327
    // e2 appears at rank 2 in vector (score=1/62) and rank 1 in bm25 (score=1/61): total ≈ 0.0327
    // They should be equal or close
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.entity.id);
    expect(ids).toContain('e1');
    expect(ids).toContain('e2');
  });

  it('produces higher combined score for entity in both lists than entity in one', () => {
    // overlap: e1 rank 1 in both → high score
    // unique: e3 rank 1 in bm25 only
    const vectorList = [makeResult('e1', 0.9)];
    const bm25List = [makeResult('e1', 0.8), makeResult('e3', 0.7)];
    const result = reciprocalRankFusion(vectorList, bm25List);
    const e1Score = result.find((r) => r.entity.id === 'e1')!.score;
    const e3Score = result.find((r) => r.entity.id === 'e3')!.score;
    expect(e1Score).toBeGreaterThan(e3Score);
  });

  it('results are sorted by descending RRF score', () => {
    const vectorList = [makeResult('e1', 0.9), makeResult('e2', 0.6)];
    const bm25List = [makeResult('e2', 0.95)]; // e2 in both lists boosts it
    const result = reciprocalRankFusion(vectorList, bm25List);
    // e2 appears in both → higher combined score than e1 which appears in one
    expect(result[0]!.entity.id).toBe('e2');
  });

  it('respects custom k parameter', () => {
    const vectorList = [makeResult('e1', 0.9)];
    const bm25List = [makeResult('e2', 0.8)];
    const resultK60 = reciprocalRankFusion(vectorList, bm25List, 60);
    const resultK1 = reciprocalRankFusion(vectorList, bm25List, 1);
    // Both should have 2 results; k changes magnitudes but not ordering here (both rank 1)
    expect(resultK60).toHaveLength(2);
    expect(resultK1).toHaveLength(2);
    // With k=1, scores are much larger: 1/(1+1) = 0.5 vs 1/(60+1) ≈ 0.016
    const scoreK1 = resultK1[0]!.score;
    const scoreK60 = resultK60[0]!.score;
    expect(scoreK1).toBeGreaterThan(scoreK60);
  });
});

// ─── queryExpansion option ────────────────────────────────────────────────────

describe('retrieveContext — queryExpansion', () => {
  const mockCreate = vi.fn();
  let savedEmbeddingProvider: string | undefined;

  beforeEach(() => {
    savedEmbeddingProvider = process.env['EMBEDDING_PROVIDER'];
    delete process.env['EMBEDDING_PROVIDER'];
    process.env['AZURE_OPENAI_ENDPOINT'] = 'https://test.openai.azure.com';
    process.env['AZURE_OPENAI_API_KEY'] = 'test-key';
    vi.mocked(AzureOpenAI).mockImplementation(
      () => ({ embeddings: { create: mockCreate } }) as unknown as AzureOpenAI,
    );
    mockCreate.mockResolvedValue({
      data: [{ index: 0, embedding: Array(1536).fill(0) }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
  });

  afterEach(() => {
    if (savedEmbeddingProvider !== undefined) {
      process.env['EMBEDDING_PROVIDER'] = savedEmbeddingProvider;
    } else {
      delete process.env['EMBEDDING_PROVIDER'];
    }
    delete process.env['AZURE_OPENAI_ENDPOINT'];
    delete process.env['AZURE_OPENAI_API_KEY'];
    vi.clearAllMocks();
  });

  it('calls expandQuery when queryExpansion=true and openAiApiKey is set', async () => {
    vi.mocked(expandQuery).mockResolvedValueOnce('pipeline forecast ARR');
    const store = makeMockVectorStore([]);
    await retrieveContext('pipeline', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      queryExpansion: true,
      openAiApiKey: 'sk-test',
      availableEntityTypes: ['deal'],
    });
    expect(expandQuery).toHaveBeenCalledWith(
      'pipeline',
      'ws-1',
      ['deal'],
      'sk-test',
      undefined,
      undefined,
    );
  });

  it('does NOT call expandQuery when queryExpansion=false', async () => {
    const store = makeMockVectorStore([]);
    await retrieveContext('pipeline', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      queryExpansion: false,
      openAiApiKey: 'sk-test',
    });
    expect(expandQuery).not.toHaveBeenCalled();
  });

  it('does NOT call expandQuery when openAiApiKey is missing', async () => {
    const store = makeMockVectorStore([]);
    await retrieveContext('pipeline', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      queryExpansion: true,
    });
    expect(expandQuery).not.toHaveBeenCalled();
  });

  it('embeds the expanded query string', async () => {
    vi.mocked(expandQuery).mockResolvedValueOnce('pipeline forecast ARR');
    const store = makeMockVectorStore([]);
    await retrieveContext('pipeline', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      queryExpansion: true,
      openAiApiKey: 'sk-test',
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'pipeline forecast ARR' }),
    );
  });

  it('falls back to original query when expandQuery throws', async () => {
    vi.mocked(expandQuery).mockRejectedValueOnce(new Error('LLM error'));
    const store = makeMockVectorStore([]);
    const result = await retrieveContext('pipeline', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
      queryExpansion: true,
      openAiApiKey: 'sk-test',
    });
    expect(result.entities).toBeDefined();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'pipeline' }),
    );
  });
});
