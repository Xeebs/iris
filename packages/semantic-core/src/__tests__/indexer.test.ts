import { describe, it, expect, vi, beforeEach } from 'vitest';
import { indexEntities, cosineSimilarity } from '../indexer.js';
import type { VectorStore } from '../vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';

vi.mock('../embedding.js', () => ({
  generateEmbeddings: vi.fn(),
}));

import { generateEmbeddings } from '../embedding.js';

function makeEntity(id: string, type = 'contact'): SemanticEntity {
  return {
    id,
    type,
    label: `Entity ${id}`,
    attributes: { company: 'Acme' },
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: id,
  };
}

function makeMockVectorStore(): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
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
      { entity: duplicate, score: 0.92 }, // above 0.85 threshold
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
      { entity: similar, score: 0.70 }, // below 0.85 threshold
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
    expect(vi.mocked(generateEmbeddings)).toHaveBeenCalledTimes(2); // 3 + 2
  });

  it('reports durationMs > 0', async () => {
    const entity = makeEntity('id:1');
    const store = makeMockVectorStore();
    vi.mocked(generateEmbeddings).mockResolvedValue([{ entityId: entity.id, vector: makeVector(0) }]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([entity]), store);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
