import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SemanticCache } from '@iris/cache/semantic-cache';
import type { VectorStore } from '@iris/semantic-core';
import type { SemanticEntity } from '@iris/connector-sdk';

import { registerQueryContext } from '../tools/query-context.js';
import { registerListEntities } from '../tools/list-entities.js';
import { registerGetEntity } from '../tools/get-entity.js';
import { registerGetMetric } from '../tools/get-metric.js';
import { registerListGlossary } from '../tools/list-glossary.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'hubspot:contact:1',
    type: 'contact',
    label: 'Alice Smith',
    attributes: { email: 'alice@example.com', stage: 'lead' },
    relationships: [],
    lastModified: new Date('2024-01-01'),
    sourceId: 'hubspot:contact:1',
    ...overrides,
  };
}

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function makeMockServer(): { server: McpServer; getHandler: (name: string) => ToolHandler } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;
  return {
    server,
    getHandler: (name: string) => {
      const h = handlers.get(name);
      if (!h) throw new Error(`Tool "${name}" not registered`);
      return h;
    },
  };
}

function makeMockVectorStore(): VectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    listByType: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
  } as unknown as VectorStore;
}

function makeMockCache(): SemanticCache {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as SemanticCache;
}

// ─── list-entities ───────────────────────────────────────────────────────────

describe('list-entities tool', () => {
  let vectorStore: VectorStore;
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;

  beforeEach(() => {
    vectorStore = makeMockVectorStore();
    ({ server, getHandler } = makeMockServer());
    registerListEntities(server, vectorStore);
  });

  it('registers the tool', () => {
    expect(server.registerTool).toHaveBeenCalledWith(
      'list-entities',
      expect.objectContaining({ title: 'List Entities' }),
      expect.any(Function),
    );
  });

  it('returns "no entities" message when empty', async () => {
    const handler = getHandler('list-entities');
    const result = await handler({ entityType: 'contact', workspaceId: 'ws1', limit: 10, contextBudget: 2000 });
    expect(result.content[0]?.text).toContain('No entities of type "contact"');
  });

  it('returns serialized entities when found', async () => {
    vi.mocked(vectorStore.listByType).mockResolvedValue([makeEntity()]);
    const handler = getHandler('list-entities');
    const result = await handler({ entityType: 'contact', workspaceId: 'ws1', limit: 10, contextBudget: 2000 });
    expect(result.content[0]?.text).toContain('Alice Smith');
    expect(result.isError).toBeFalsy();
  });

  it('returns error content on failure', async () => {
    vi.mocked(vectorStore.listByType).mockRejectedValue(new Error('DB error'));
    const handler = getHandler('list-entities');
    const result = await handler({ entityType: 'contact', workspaceId: 'ws1', limit: 10, contextBudget: 2000 });
    expect(result.content[0]?.text).toContain('DB error');
    expect(result.isError).toBe(true);
  });
});

// ─── get-entity ──────────────────────────────────────────────────────────────

describe('get-entity tool', () => {
  let vectorStore: VectorStore;
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;

  beforeEach(() => {
    vectorStore = makeMockVectorStore();
    ({ server, getHandler } = makeMockServer());
    registerGetEntity(server, vectorStore);
  });

  it('registers the tool', () => {
    expect(server.registerTool).toHaveBeenCalledWith('get-entity', expect.anything(), expect.any(Function));
  });

  it('returns "not found" when entity does not exist', async () => {
    const handler = getHandler('get-entity');
    const result = await handler({ id: 'hubspot:contact:999', workspaceId: 'ws1' });
    expect(result.content[0]?.text).toContain('not found');
  });

  it('returns serialized entity when found', async () => {
    vi.mocked(vectorStore.getById).mockResolvedValue(makeEntity());
    const handler = getHandler('get-entity');
    const result = await handler({ id: 'hubspot:contact:1', workspaceId: 'ws1' });
    expect(result.content[0]?.text).toContain('Alice Smith');
    expect(result.content[0]?.text).toContain('[contact]');
  });

  it('returns error content on failure', async () => {
    vi.mocked(vectorStore.getById).mockRejectedValue(new Error('connection lost'));
    const handler = getHandler('get-entity');
    const result = await handler({ id: 'x', workspaceId: 'ws1' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('connection lost');
  });
});

// ─── get-metric ──────────────────────────────────────────────────────────────

describe('get-metric tool', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;

  beforeEach(() => {
    ({ server, getHandler } = makeMockServer());
    registerGetMetric(server);
  });

  it('registers the tool', () => {
    expect(server.registerTool).toHaveBeenCalledWith('get-metric', expect.anything(), expect.any(Function));
  });

  it('returns placeholder message for unknown metric', async () => {
    const handler = getHandler('get-metric');
    const result = await handler({ metricId: 'monthly_revenue', workspaceId: 'ws1' });
    expect(result.content[0]?.text).toContain('monthly_revenue');
    expect(result.content[0]?.text).toContain('under development');
  });
});

// ─── list-glossary ───────────────────────────────────────────────────────────

describe('list-glossary tool', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;

  beforeEach(() => {
    ({ server, getHandler } = makeMockServer());
    registerListGlossary(server);
  });

  it('registers the tool', () => {
    expect(server.registerTool).toHaveBeenCalledWith('list-glossary', expect.anything(), expect.any(Function));
  });

  it('returns placeholder message when no terms exist', async () => {
    const handler = getHandler('list-glossary');
    const result = await handler({ workspaceId: 'ws1' });
    expect(result.content[0]?.text).toContain('No glossary terms');
  });

  it('includes filter text in the response', async () => {
    const handler = getHandler('list-glossary');
    const result = await handler({ workspaceId: 'ws1', filter: 'churn' });
    expect(result.content[0]?.text).toContain('churn');
  });
});

// ─── query-context ───────────────────────────────────────────────────────────

describe('query-context tool', () => {
  let vectorStore: VectorStore;
  let cache: SemanticCache;
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;

  beforeEach(() => {
    vectorStore = makeMockVectorStore();
    cache = makeMockCache();
    ({ server, getHandler } = makeMockServer());
    registerQueryContext(server, vectorStore, cache, 'test-key');
  });

  it('registers the tool', () => {
    expect(server.registerTool).toHaveBeenCalledWith('query-context', expect.anything(), expect.any(Function));
  });

  it('returns error content when retrieval throws', async () => {
    vi.mocked(vectorStore.search).mockRejectedValue(new Error('vector search failed'));
    const handler = getHandler('query-context');
    const result = await handler({ query: 'show me deals', workspaceId: 'ws1', contextBudget: 2000, topK: 10 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error:');
  });
});
