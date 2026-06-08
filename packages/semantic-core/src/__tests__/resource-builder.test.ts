import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildEntityResource,
  buildGraphResource,
  listEntityResourceURIs,
} from '../resource-builder.js';
import type { VectorStore, VectorSearchResult } from '../vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const WORKSPACE = 'ws-test';

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'hubspot:contact:1',
    type: 'contact',
    label: 'Alice Smith',
    attributes: { email: 'alice@example.com', company: 'Acme' },
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: 'hubspot:contact:1',
    ...overrides,
  };
}

function makeVectorStore(overrides: Partial<VectorStore> = {}): VectorStore {
  return {
    initialize: vi.fn(),
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    listByType: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    close: vi.fn(),
    ...overrides,
  } as unknown as VectorStore;
}

describe('buildEntityResource', () => {
  it('returns null when entity not found', async () => {
    const store = makeVectorStore({ getById: vi.fn().mockResolvedValue(null) });
    const result = await buildEntityResource('missing', WORKSPACE, store);
    expect(result).toBeNull();
  });

  it('returns EntityResource with correct URI scheme', async () => {
    const entity = makeEntity();
    const store = makeVectorStore({ getById: vi.fn().mockResolvedValue(entity) });
    const result = await buildEntityResource(entity.id, WORKSPACE, store);
    expect(result).not.toBeNull();
    expect(result!.uri).toBe(`entity://${WORKSPACE}/${entity.id}`);
    expect(result!.mimeType).toBe('application/json');
  });

  it('serializes entity as JSON in text field', async () => {
    const entity = makeEntity();
    const store = makeVectorStore({ getById: vi.fn().mockResolvedValue(entity) });
    const result = await buildEntityResource(entity.id, WORKSPACE, store);
    const parsed = JSON.parse(result!.text) as SemanticEntity;
    expect(parsed.id).toBe(entity.id);
    expect(parsed.label).toBe('Alice Smith');
  });

  it('calls getById with correct workspace and id', async () => {
    const getById = vi.fn().mockResolvedValue(makeEntity());
    const store = makeVectorStore({ getById });
    await buildEntityResource('hubspot:contact:1', WORKSPACE, store);
    expect(getById).toHaveBeenCalledWith(WORKSPACE, 'hubspot:contact:1');
  });
});

describe('buildGraphResource', () => {
  it('returns null when root entity not found', async () => {
    const store = makeVectorStore({ getById: vi.fn().mockResolvedValue(null) });
    const result = await buildGraphResource('missing', WORKSPACE, store);
    expect(result).toBeNull();
  });

  it('returns GraphResource with correct URI scheme', async () => {
    const root = makeEntity();
    const store = makeVectorStore({ getById: vi.fn().mockResolvedValue(root) });
    const result = await buildGraphResource(root.id, WORKSPACE, store, 1);
    expect(result).not.toBeNull();
    expect(result!.uri).toContain(`graph://${WORKSPACE}/${root.id}`);
    expect(result!.mimeType).toBe('application/json');
  });

  it('includes root entity in graph text', async () => {
    const root = makeEntity();
    const store = makeVectorStore({ getById: vi.fn().mockResolvedValue(root) });
    const result = await buildGraphResource(root.id, WORKSPACE, store, 1);
    const parsed = JSON.parse(result!.text) as { root: SemanticEntity };
    expect(parsed.root.id).toBe(root.id);
  });

  it('traverses one-hop relationships', async () => {
    const related = makeEntity({ id: 'hubspot:company:1', type: 'company', label: 'Acme' });
    const root = makeEntity({ relationships: [{ type: 'belongs_to', targetId: related.id }] });
    const getById = vi.fn()
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(related);
    const store = makeVectorStore({ getById });
    const result = await buildGraphResource(root.id, WORKSPACE, store, 1);
    const parsed = JSON.parse(result!.text) as { related: SemanticEntity[] };
    expect(parsed.related).toHaveLength(1);
    expect(parsed.related[0]!.id).toBe(related.id);
  });

  it('clamps depth to 2', async () => {
    const root = makeEntity();
    const getById = vi.fn().mockResolvedValue(root);
    const store = makeVectorStore({ getById });
    const result = await buildGraphResource(root.id, WORKSPACE, store, 5);
    expect(result!.uri).toContain('depth=2');
  });

  it('skips already-visited nodes to prevent cycles', async () => {
    const other = makeEntity({ id: 'hubspot:company:1', type: 'company', label: 'Acme' });
    const root = makeEntity({
      relationships: [
        { type: 'belongs_to', targetId: other.id },
        { type: 'relates_to', targetId: other.id },
      ],
    });
    const getById = vi.fn()
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(other);
    const store = makeVectorStore({ getById });
    const result = await buildGraphResource(root.id, WORKSPACE, store, 1);
    const parsed = JSON.parse(result!.text) as { related: SemanticEntity[] };
    expect(parsed.related).toHaveLength(1);
  });

  it('silently skips missing related entities', async () => {
    const root = makeEntity({
      relationships: [{ type: 'belongs_to', targetId: 'missing:entity:1' }],
    });
    const getById = vi.fn()
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(null);
    const store = makeVectorStore({ getById });
    const result = await buildGraphResource(root.id, WORKSPACE, store, 1);
    const parsed = JSON.parse(result!.text) as { related: SemanticEntity[] };
    expect(parsed.related).toHaveLength(0);
  });
});

describe('listEntityResourceURIs', () => {
  it('returns empty array when no entities found', async () => {
    const store = makeVectorStore({ search: vi.fn().mockResolvedValue([]) });
    const result = await listEntityResourceURIs(WORKSPACE, store);
    expect(result).toEqual([]);
  });

  it('maps search results to entity:// URIs', async () => {
    const entity = makeEntity();
    const searchResult: VectorSearchResult = { entity, score: 0.9 };
    const store = makeVectorStore({ search: vi.fn().mockResolvedValue([searchResult]) });
    const result = await listEntityResourceURIs(WORKSPACE, store);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(`entity://${WORKSPACE}/${entity.id}`);
  });

  it('calls search with default limit of 100', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const store = makeVectorStore({ search });
    await listEntityResourceURIs(WORKSPACE, store);
    const [, limit] = search.mock.calls[0] as [unknown, number];
    expect(limit).toBe(100);
  });
});
