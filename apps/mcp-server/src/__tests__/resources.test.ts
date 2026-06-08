import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VectorStore, VectorSearchResult } from '@iris/semantic-core';
import type { SemanticEntity } from '@iris/connector-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

function makeEntity(id: string, type = 'contact', rels: { type: string; targetId: string }[] = []): SemanticEntity {
  return {
    id,
    type,
    label: `Label for ${id}`,
    attributes: { field: 'value' },
    relationships: rels,
    lastModified: new Date('2026-01-01T00:00:00Z'),
    sourceId: id,
  };
}

function makeVectorStore(entities: SemanticEntity[]): VectorStore {
  const byId = new Map(entities.map((e) => [e.id, e]));
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue(
      entities.map((e, i) => ({ entity: e, score: 1 - i * 0.01 }) as VectorSearchResult),
    ),
    getById: vi.fn().mockImplementation((_ws: string, id: string) => Promise.resolve(byId.get(id) ?? null)),
    delete: vi.fn(),
    listWorkspaceEntities: vi.fn().mockResolvedValue([]),
  } as unknown as VectorStore;
}

describe('MCP Resource Registration', () => {
  it('entity, document, and graph resources register without throwing', async () => {
    const { registerEntityResource } = await import('../resources/entity-resource.js');
    const { registerDocumentResource } = await import('../resources/document-resource.js');
    const { registerGraphResource } = await import('../resources/graph-resource.js');
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    const vs = makeVectorStore([]);
    expect(() => registerEntityResource(server, vs)).not.toThrow();
    expect(() => registerDocumentResource(server)).not.toThrow();
    expect(() => registerGraphResource(server, vs)).not.toThrow();
  });
});

describe('buildEntityResource', () => {
  it('returns null for a missing entity', async () => {
    const { buildEntityResource } = await import('@iris/semantic-core/resource-builder');
    const vs = makeVectorStore([]);
    const result = await buildEntityResource('missing:entity:1', 'ws-1', vs);
    expect(result).toBeNull();
  });

  it('returns a JSON resource for an existing entity', async () => {
    const { buildEntityResource } = await import('@iris/semantic-core/resource-builder');
    const entity = makeEntity('hubspot:contact:1');
    const vs = makeVectorStore([entity]);
    const result = await buildEntityResource('hubspot:contact:1', 'ws-1', vs);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('application/json');
    expect(result!.uri).toContain('entity://ws-1/hubspot:contact:1');
    const parsed = JSON.parse(result!.text);
    expect(parsed.id).toBe('hubspot:contact:1');
  });
});

describe('buildGraphResource', () => {
  it('returns null when root entity is missing', async () => {
    const { buildGraphResource } = await import('@iris/semantic-core/resource-builder');
    const vs = makeVectorStore([]);
    const result = await buildGraphResource('missing', 'ws-1', vs);
    expect(result).toBeNull();
  });

  it('returns graph with related entities at depth 1', async () => {
    const { buildGraphResource } = await import('@iris/semantic-core/resource-builder');
    const root = makeEntity('hubspot:contact:1', 'contact', [{ type: 'belongs_to', targetId: 'hubspot:company:2' }]);
    const related = makeEntity('hubspot:company:2', 'company');
    const vs = makeVectorStore([root, related]);

    const result = await buildGraphResource('hubspot:contact:1', 'ws-1', vs, 1);
    expect(result).not.toBeNull();
    const graph = JSON.parse(result!.text);
    expect(graph.root.id).toBe('hubspot:contact:1');
    expect(graph.related).toHaveLength(1);
    expect(graph.related[0].id).toBe('hubspot:company:2');
    expect(graph.depth).toBe(1);
  });

  it('clamps depth to 2', async () => {
    const { buildGraphResource } = await import('@iris/semantic-core/resource-builder');
    const root = makeEntity('e:1');
    const vs = makeVectorStore([root]);
    const result = await buildGraphResource('e:1', 'ws-1', vs, 99);
    const graph = JSON.parse(result!.text);
    expect(graph.depth).toBe(2);
  });

  it('does not revisit already-traversed entities', async () => {
    const { buildGraphResource } = await import('@iris/semantic-core/resource-builder');
    const a = makeEntity('a:1', 'node', [{ type: 'link', targetId: 'b:1' }]);
    const b = makeEntity('b:1', 'node', [{ type: 'link', targetId: 'a:1' }]);
    const vs = makeVectorStore([a, b]);
    const result = await buildGraphResource('a:1', 'ws-1', vs, 2);
    const graph = JSON.parse(result!.text);
    expect(graph.related).toHaveLength(1);
    expect(graph.related[0].id).toBe('b:1');
  });
});

describe('listEntityResourceURIs', () => {
  it('returns URIs for each entity', async () => {
    const { listEntityResourceURIs } = await import('@iris/semantic-core/resource-builder');
    const entities = [makeEntity('e:1'), makeEntity('e:2')];
    const vs = makeVectorStore(entities);
    const uris = await listEntityResourceURIs('ws-1', vs);
    expect(uris).toContain('entity://ws-1/e:1');
    expect(uris).toContain('entity://ws-1/e:2');
  });
});
