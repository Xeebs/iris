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

describe('buildGraphResource depth 0', () => {
  it('returns root entity only when depth is 0', async () => {
    const root = makeEntity({ relationships: [{ type: 'belongs_to', targetId: 'should-not-fetch' }] });
    const getById = vi.fn().mockResolvedValue(root);
    const store = makeVectorStore({ getById });
    const result = await buildGraphResource(root.id, WORKSPACE, store, 0);
    const parsed = JSON.parse(result!.text) as { related: SemanticEntity[]; depth: number };
    expect(parsed.related).toHaveLength(0);
    expect(parsed.depth).toBe(0);
    // getById called once for root, not for the relationship target
    expect(getById).toHaveBeenCalledTimes(1);
  });
});

describe('buildGraphResource depth 2 traversal', () => {
  it('fetches second-hop entities', async () => {
    const grandchild = makeEntity({ id: 'hubspot:deal:1', type: 'deal', label: 'Big Deal' });
    const child = makeEntity({
      id: 'hubspot:company:1',
      type: 'company',
      label: 'Acme',
      relationships: [{ type: 'has_deal', targetId: grandchild.id }],
    });
    const root = makeEntity({ relationships: [{ type: 'belongs_to', targetId: child.id }] });
    const getById = vi.fn()
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(child)
      .mockResolvedValueOnce(grandchild);
    const store = makeVectorStore({ getById });
    const result = await buildGraphResource(root.id, WORKSPACE, store, 2);
    const parsed = JSON.parse(result!.text) as { related: SemanticEntity[]; depth: number };
    expect(parsed.depth).toBe(2);
    expect(parsed.related.some((e) => e.id === grandchild.id)).toBe(true);
  });

  it('prevents circular references via bidirectional edges at depth 2', async () => {
    const nodeB = makeEntity({ id: 'entity:b', type: 'contact', label: 'B', relationships: [] });
    const nodeA = makeEntity({ relationships: [{ type: 'knows', targetId: nodeB.id }] });
    // Make nodeB point back to nodeA
    nodeB.relationships = [{ type: 'knows', targetId: nodeA.id }];
    const getById = vi.fn()
      .mockImplementation((_ws: string, id: string) => {
        if (id === nodeA.id) return Promise.resolve(nodeA);
        if (id === nodeB.id) return Promise.resolve(nodeB);
        return Promise.resolve(null);
      });
    const store = makeVectorStore({ getById });
    const result = await buildGraphResource(nodeA.id, WORKSPACE, store, 2);
    const parsed = JSON.parse(result!.text) as { related: SemanticEntity[] };
    // nodeA (root) must not appear in related
    expect(parsed.related.some((e) => e.id === nodeA.id)).toBe(false);
    // nodeB should appear exactly once
    expect(parsed.related.filter((e) => e.id === nodeB.id)).toHaveLength(1);
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

  it('passes custom limit to search', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const store = makeVectorStore({ search });
    await listEntityResourceURIs(WORKSPACE, store, undefined, 25);
    const [, limit] = search.mock.calls[0] as [unknown, number];
    expect(limit).toBe(25);
  });

  it('passes entityTypes filter in search options when provided', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const store = makeVectorStore({ search });
    await listEntityResourceURIs(WORKSPACE, store, ['contact', 'company']);
    const [, , filter] = search.mock.calls[0] as [unknown, unknown, { entityTypes?: string[] }];
    expect(filter?.entityTypes).toEqual(['contact', 'company']);
  });

  it('omits entityTypes from filter when not provided', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const store = makeVectorStore({ search });
    await listEntityResourceURIs(WORKSPACE, store);
    const [, , filter] = search.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(filter?.entityTypes).toBeUndefined();
  });

  it('uses a zero vector of length 1536 for the search query', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const store = makeVectorStore({ search });
    await listEntityResourceURIs(WORKSPACE, store);
    const [vector] = search.mock.calls[0] as [number[], ...unknown[]];
    expect(vector).toHaveLength(1536);
    expect(vector.every((v) => v === 0)).toBe(true);
  });
});
