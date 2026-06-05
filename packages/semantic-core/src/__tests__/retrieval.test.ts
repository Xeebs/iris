import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retrieveContext } from '../retrieval.js';
import type { VectorStore } from '../vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import OpenAI from 'openai';

vi.mock('openai');

function makeEntity(id: string, type = 'contact', relationships: SemanticEntity['relationships'] = []): SemanticEntity {
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

function makeMockVectorStore(results: Array<{ entity: SemanticEntity; score: number }> = []): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(results),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

const mockQueryVector = Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0);

describe('retrieveContext', () => {
  const mockCreate = vi.fn();

  beforeEach(() => {
    vi.mocked(OpenAI).mockImplementation(() => ({
      embeddings: { create: mockCreate },
    }) as unknown as OpenAI);
    mockCreate.mockResolvedValue({
      data: [{ index: 0, embedding: mockQueryVector }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
  });

  afterEach(() => {
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

  it('expands related entities when expandRelationships=true', async () => {
    const company = makeEntity('hubspot:company:2');
    const contact = makeEntity('hubspot:contact:1', 'contact', [
      { type: 'belongs_to', targetId: 'hubspot:company:2' },
    ]);

    const store = makeMockVectorStore([{ entity: contact, score: 0.9 }]);
    vi.mocked(store.search)
      .mockResolvedValueOnce([{ entity: contact, score: 0.9 }])
      .mockResolvedValueOnce([{ entity: company, score: 0.8 }]);

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
  });

  it('does not expand when expandRelationships=false', async () => {
    const contact = makeEntity('hubspot:contact:1', 'contact', [
      { type: 'belongs_to', targetId: 'hubspot:company:2' },
    ]);
    const store = makeMockVectorStore([{ entity: contact, score: 0.9 }]);

    const result = await retrieveContext('query', store, {
      workspaceId: 'ws-1',
      topK: 5,
      expandRelationships: false,
      maxDepth: 0,
    });

    expect(result.entities).toHaveLength(1);
    expect(store.search).toHaveBeenCalledOnce();
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
});
