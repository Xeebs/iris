import { describe, it, expect, vi, beforeEach } from 'vitest';
import { indexEntities, cosineSimilarity } from '../indexer.js';
import type { RelationshipStore } from '../indexer.js';
import type { VectorStore } from '../vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import { ok, err } from 'neverthrow';

vi.mock('../embedding.js', () => ({
  generateEmbeddings: vi.fn(),
}));
vi.mock('../entity-enricher.js', () => ({
  EntityEnricher: vi.fn(),
}));

import { generateEmbeddings } from '../embedding.js';
import { EntityEnricher } from '../entity-enricher.js';

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
    expect(store.upsert).toHaveBeenCalledWith([entity], [makeVector(0)], undefined);
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

  // ─── Entity enrichment ────────────────────────────────────────────────

  it('calls enrichEntity for each entity when enrichEntities is enabled', async () => {
    const e1 = makeEntity('id:1');
    const e2 = makeEntity('id:2');
    const store = makeMockVectorStore();

    const mockEnricher = {
      enrichEntity: vi.fn().mockResolvedValue(['term-a', 'term-b']),
    };
    vi.mocked(EntityEnricher).mockImplementation(() => mockEnricher as unknown as EntityEnricher);

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: e1.id, vector: makeVector(0) },
      { entityId: e2.id, vector: makeVector(1) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    await indexEntities(makeEntityGen([e1, e2]), store, {
      enrichEntities: true,
      entityEnricher: new EntityEnricher('sk-test') as unknown as InstanceType<typeof EntityEnricher>,
      workspaceId: 'ws-1',
    });

    expect(mockEnricher.enrichEntity).toHaveBeenCalledTimes(2);
    expect(mockEnricher.enrichEntity).toHaveBeenCalledWith(e1, 'ws-1');
    expect(mockEnricher.enrichEntity).toHaveBeenCalledWith(e2, 'ws-1');
  });

  it('passes enrichedTermsMap to generateEmbeddings', async () => {
    const entity = makeEntity('id:1');
    const store = makeMockVectorStore();

    const mockEnricher = { enrichEntity: vi.fn().mockResolvedValue(['sprint', 'backlog']) };
    vi.mocked(EntityEnricher).mockImplementation(() => mockEnricher as unknown as EntityEnricher);

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: entity.id, vector: makeVector(0) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    await indexEntities(makeEntityGen([entity]), store, {
      enrichEntities: true,
      entityEnricher: new EntityEnricher('sk-test') as unknown as InstanceType<typeof EntityEnricher>,
      workspaceId: 'ws-1',
    });

    expect(vi.mocked(generateEmbeddings)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        enrichedTermsMap: new Map([['id:1', ['sprint', 'backlog']]]),
      }),
    );
  });

  it('restricts enrichment to allowlisted entity types', async () => {
    const contact = makeEntity('id:1', 'contact');
    const issue = makeEntity('id:2', 'issue');
    const store = makeMockVectorStore();

    const mockEnricher = { enrichEntity: vi.fn().mockResolvedValue(['term']) };
    vi.mocked(EntityEnricher).mockImplementation(() => mockEnricher as unknown as EntityEnricher);

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: contact.id, vector: makeVector(0) },
      { entityId: issue.id, vector: makeVector(1) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    await indexEntities(makeEntityGen([contact, issue]), store, {
      enrichEntities: true,
      entityEnricher: new EntityEnricher('sk-test') as unknown as InstanceType<typeof EntityEnricher>,
      workspaceId: 'ws-1',
      enrichEntityTypes: ['issue'],
    });

    expect(mockEnricher.enrichEntity).toHaveBeenCalledTimes(1);
    expect(mockEnricher.enrichEntity).toHaveBeenCalledWith(issue, 'ws-1');
  });

  it('omits enrichedTermsMap when all enrichment returns empty', async () => {
    const entity = makeEntity('id:1');
    const store = makeMockVectorStore();

    const mockEnricher = { enrichEntity: vi.fn().mockResolvedValue([]) };
    vi.mocked(EntityEnricher).mockImplementation(() => mockEnricher as unknown as EntityEnricher);

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: entity.id, vector: makeVector(0) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    await indexEntities(makeEntityGen([entity]), store, {
      enrichEntities: true,
      entityEnricher: new EntityEnricher('sk-test') as unknown as InstanceType<typeof EntityEnricher>,
      workspaceId: 'ws-1',
    });

    const callArgs = vi.mocked(generateEmbeddings).mock.calls[0]?.[1];
    expect(callArgs?.enrichedTermsMap).toBeUndefined();
  });

  it('does not call enrichEntity when enrichEntities is false', async () => {
    const entity = makeEntity('id:1');
    const store = makeMockVectorStore();

    const mockEnricher = { enrichEntity: vi.fn().mockResolvedValue(['term']) };
    vi.mocked(EntityEnricher).mockImplementation(() => mockEnricher as unknown as EntityEnricher);

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: entity.id, vector: makeVector(0) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    await indexEntities(makeEntityGen([entity]), store, {
      enrichEntities: false,
      entityEnricher: new EntityEnricher('sk-test') as unknown as InstanceType<typeof EntityEnricher>,
      workspaceId: 'ws-1',
    });

    expect(mockEnricher.enrichEntity).not.toHaveBeenCalled();
  });

  it('continues indexing when enrichEntity rejects (via Promise.allSettled)', async () => {
    const e1 = makeEntity('id:1');
    const e2 = makeEntity('id:2');
    const store = makeMockVectorStore();

    const mockEnricher = {
      enrichEntity: vi.fn()
        .mockRejectedValueOnce(new Error('LLM timeout'))
        .mockResolvedValueOnce(['good-term']),
    };
    vi.mocked(EntityEnricher).mockImplementation(() => mockEnricher as unknown as EntityEnricher);

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: e1.id, vector: makeVector(0) },
      { entityId: e2.id, vector: makeVector(1) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([e1, e2]), store, {
      enrichEntities: true,
      entityEnricher: new EntityEnricher('sk-test') as unknown as InstanceType<typeof EntityEnricher>,
      workspaceId: 'ws-1',
    });

    expect(result.created).toBe(2);
  });

  it('continues indexing when enrichEntities=true but no entityEnricher provided', async () => {
    const entity = makeEntity('id:1');
    const store = makeMockVectorStore();

    vi.mocked(generateEmbeddings).mockResolvedValue([
      { entityId: entity.id, vector: makeVector(0) },
    ]);
    vi.mocked(store.search).mockResolvedValue([]);

    const result = await indexEntities(makeEntityGen([entity]), store, {
      enrichEntities: true,
      workspaceId: 'ws-1',
    });

    expect(result.created).toBe(1);
    const callArgs = vi.mocked(generateEmbeddings).mock.calls[0]?.[1];
    expect(callArgs?.enrichedTermsMap).toBeUndefined();
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
