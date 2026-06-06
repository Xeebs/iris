import { describe, it, expect, vi, beforeEach } from 'vitest';
import { indexEntities, cosineSimilarity } from '../indexer.js';
import type { RelationshipStore } from '../indexer.js';
import type { VectorStore } from '../vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import { ok, err } from 'neverthrow';

vi.mock('../embedding.js', () => ({
  generateEmbeddings: vi.fn(),
}));

import { generateEmbeddings } from '../embedding.js';

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

function makeMockVectorStore(): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    listByType: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
  };
}

function makeMockGraphStore(): RelationshipStore {
  return {
    addEntity: vi.fn().mockResolvedValue(ok(undefined)),
    addRelationship: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeVector(seed = 0): number[] {
  return Array.from({ length: 1536 }, (_, i) => (i === seed ? 1 : 0));
}

async function* makeEntityGen(entities: SemanticEntity[]): AsyncGenerator<SemanticEntity> {
  for (const e of entities) yield e;
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('indexEntities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts for empty stream', async () => {
    const store = makeMockVectorStore();
    vi.mocked(generateEmbeddings).mockResolvedValue([]);
    const result = await indexEntities(makeEntityGen([]), store);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.deduplicated).toBe(0);
    expect(result.relationshipsIndexed).toBe(0);
  });

  it('creates new entities when no duplicates exist', async () => {
    const entity = makeEntity('hubspot:contact:1');
    const store = makeMockVectorStore();
    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: entity.id, vector: makeVector(0) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([entity]), store);
    expect(result.created).toBe(1);
    expect(result.deduplicated).toBe(0);
    expect(store.upsert).toHaveBeenCalledWith([entity], [makeVector(0)]);
  });

  it('deduplicates entities with similarity above threshold', async () => {
    const entity = makeEntity('hubspot:contact:1');
    const duplicate = makeEntity('hubspot:contact:999');
    const store = makeMockVectorStore();
    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: entity.id, vector: makeVector(0) },
    ]);
    vi.mocked(store.search).mockResolvedValue([
      { entity: duplicate, score: 0.92 },
    ]);

    const result = await indexEntities(makeEntityGen([entity]), store, { dedupThreshold: 0.85 });
    expect(result.deduplicated).toBe(1);
    expect(result.created).toBe(0);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('does not deduplicate entities with similarity below threshold', async () => {
    const entity = makeEntity('hubspot:contact:1');
    const similar = makeEntity('hubspot:contact:2');
    const store = makeMockVectorStore();
    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: entity.id, vector: makeVector(0) },
    ]);
    vi.mocked(store.search).mockResolvedValue([
      { entity: similar, score: 0.70 },
    ]);

    const result = await indexEntities(makeEntityGen([entity]), store, { dedupThreshold: 0.85 });
    expect(result.created).toBe(1);
    expect(result.deduplicated).toBe(0);
  });

  it('processes entities in batches', async () => {
    const entities = Array.from({ length: 5 }, (_, i) => makeEntity(`id:${i}`));
    const store = makeMockVectorStore();
    vi.mocked(generateEmbeddings).mockResolvedValue(
      entities.map((e, i) => ({ entityId: e.id, vector: makeVector(i) })),
    );
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen(entities), store, { batchSize: 3 });
    expect(result.created).toBe(5);
    expect(vi.mocked(generateEmbeddings)).toHaveBeenCalledTimes(2);
  });

  it('reports durationMs >= 0', async () => {
    const entity = makeEntity('id:1');
    const store = makeMockVectorStore();
    vi.mocked(generateEmbeddings).mockResolvedValue([{ entityId: entity.id, vector: makeVector(0) }]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([entity]), store);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ─── Graph store integration ───────────────────────────────────────────

  it('indexes entity relationships to the graph store when provided', async () => {
    const entity = makeEntity('hubspot:contact:1', 'contact', [
      { type: 'belongs_to', targetId: 'hubspot:company:99' },
    ]);
    const store = makeMockVectorStore();
    const graphStore = makeMockGraphStore();

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: entity.id, vector: makeVector(0) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([entity]), store, {
      graphStore,
      workspaceId: 'ws-1',
    });

    expect(graphStore.addEntity).toHaveBeenCalledOnce();
    expect(graphStore.addRelationship).toHaveBeenCalledWith(
      'hubspot:contact:1',
      'hubspot:company:99',
      'belongs_to',
      'ws-1',
    );
    expect(result.relationshipsIndexed).toBe(1);
  });

  it('counts multiple relationships across multiple entities', async () => {
    const e1 = makeEntity('c:1', 'contact', [
      { type: 'belongs_to', targetId: 'co:1' },
      { type: 'owns', targetId: 'd:1' },
    ]);
    const e2 = makeEntity('c:2', 'contact', [
      { type: 'belongs_to', targetId: 'co:1' },
    ]);
    const store = makeMockVectorStore();
    const graphStore = makeMockGraphStore();

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: e1.id, vector: makeVector(0) },
      { entityId: e2.id, vector: makeVector(1) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([e1, e2]), store, {
      graphStore,
      workspaceId: 'ws-1',
    });

    expect(result.relationshipsIndexed).toBe(3);
    expect(graphStore.addEntity).toHaveBeenCalledTimes(2);
  });

  it('does not call graphStore when workspaceId is missing', async () => {
    const entity = makeEntity('id:1', 'contact', [{ type: 'belongs_to', targetId: 'co:1' }]);
    const store = makeMockVectorStore();
    const graphStore = makeMockGraphStore();

    vi.mocked(generateEmbeddings).mockResolvedValue([{ entityId: entity.id, vector: makeVector(0) }]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([entity]), store, { graphStore }); // no workspaceId

    expect(graphStore.addEntity).not.toHaveBeenCalled();
    expect(result.relationshipsIndexed).toBe(0);
  });

  it('skips graph indexing for deduplicated entities', async () => {
    const entity = makeEntity('c:1', 'contact', [{ type: 'belongs_to', targetId: 'co:1' }]);
    const duplicate = makeEntity('c:999');
    const store = makeMockVectorStore();
    const graphStore = makeMockGraphStore();

    vi.mocked(generateEmbeddings).mockResolvedValue([{ entityId: entity.id, vector: makeVector(0) }]);
    vi.mocked(store.search).mockResolvedValue([{ entity: duplicate, score: 0.95 }]);

    const result = await indexEntities(makeEntityGen([entity]), store, {
      graphStore,
      workspaceId: 'ws-1',
      dedupThreshold: 0.85,
    });

    expect(result.deduplicated).toBe(1);
    expect(graphStore.addEntity).not.toHaveBeenCalled();
    expect(result.relationshipsIndexed).toBe(0);
  });

  it('continues indexing when graphStore.addEntity fails', async () => {
    const entity = makeEntity('c:1', 'contact', [{ type: 'belongs_to', targetId: 'co:1' }]);
    const store = makeMockVectorStore();
    const graphStore = makeMockGraphStore();
    vi.mocked(graphStore.addEntity).mockResolvedValue(err(new Error('neo4j error')));

    vi.mocked(generateEmbeddings).mockResolvedValue([{ entityId: entity.id, vector: makeVector(0) }]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([entity]), store, {
      graphStore,
      workspaceId: 'ws-1',
    });

    // Vector store still received the upsert
    expect(store.upsert).toHaveBeenCalledOnce();
    expect(result.created).toBe(1);
    expect(result.relationshipsIndexed).toBe(0);
  });
});
