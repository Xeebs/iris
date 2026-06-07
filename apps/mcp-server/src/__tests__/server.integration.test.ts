/**
 * Integration-style tests for workspace isolation across all MCP tools.
 * Uses the same stub server pattern as server.test.ts but with
 * authenticatedWorkspaceId set, exercising the full auth enforcement path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VectorStore, GlossaryService, MetricRegistry } from '@iris/semantic-core';
import type { SemanticCache } from '@iris/cache/semantic-cache';
import { ok } from 'neverthrow';

import { registerQueryContext } from '../tools/query-context.js';
import { registerListEntities } from '../tools/list-entities.js';
import { registerGetEntity } from '../tools/get-entity.js';
import { registerGetMetric } from '../tools/get-metric.js';
import { registerListGlossary } from '../tools/list-glossary.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const AUTHED_WS = 'ws-prod-abc';
const OTHER_WS = 'ws-evil-xyz';

function makeMockServer() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn((name: string, _cfg: unknown, handler: ToolHandler) => {
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

function makeVectorStore(): VectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    listByType: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
  } as unknown as VectorStore;
}

function makeGlossaryService(): GlossaryService {
  return {
    listTerms: vi.fn().mockResolvedValue(ok([])),
    addTerm: vi.fn(),
    getTerm: vi.fn(),
    deleteTerm: vi.fn(),
  } as unknown as GlossaryService;
}

function makeMetricRegistry(): MetricRegistry {
  return {
    getMetric: vi.fn().mockResolvedValue(ok(null)),
    defineMetric: vi.fn(),
    listMetrics: vi.fn(),
    deleteMetric: vi.fn(),
  } as unknown as MetricRegistry;
}

function makeSemanticCache(): SemanticCache {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as SemanticCache;
}

// ─── Workspace isolation — authenticated mode ────────────────────────────────

describe('workspace isolation (authenticated mode)', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;

  beforeEach(() => {
    const mock = makeMockServer();
    server = mock.server;
    getHandler = mock.getHandler;

    registerQueryContext(server, makeVectorStore(), makeSemanticCache(), 'test-key', AUTHED_WS);
    registerListEntities(server, makeVectorStore(), AUTHED_WS);
    registerGetEntity(server, makeVectorStore(), AUTHED_WS);
    registerGetMetric(server, makeMetricRegistry(), AUTHED_WS);
    registerListGlossary(server, makeGlossaryService(), AUTHED_WS);
  });

  it('query-context: rejects mismatched workspace', async () => {
    const h = getHandler('query-context');
    const result = await h({ query: 'top deals', workspaceId: OTHER_WS, contextBudget: 2000, topK: 5 });
    expect(result.content[0]?.text).toMatch(/access denied/i);
    expect(result.content[0]?.text).toContain(OTHER_WS);
  });

  it('list-entities: rejects mismatched workspace', async () => {
    const h = getHandler('list-entities');
    const result = await h({ entityType: 'contact', workspaceId: OTHER_WS, limit: 10, contextBudget: 2000 });
    expect(result.content[0]?.text).toMatch(/access denied/i);
    expect(result.content[0]?.text).toContain(OTHER_WS);
  });

  it('get-entity: rejects mismatched workspace', async () => {
    const h = getHandler('get-entity');
    const result = await h({ id: 'hubspot:contact:1', workspaceId: OTHER_WS });
    expect(result.content[0]?.text).toMatch(/access denied/i);
    expect(result.content[0]?.text).toContain(OTHER_WS);
  });

  it('get-metric: rejects mismatched workspace', async () => {
    const h = getHandler('get-metric');
    const result = await h({ metricId: 'revenue', workspaceId: OTHER_WS });
    expect(result.content[0]?.text).toMatch(/access denied/i);
    expect(result.content[0]?.text).toContain(OTHER_WS);
  });

  it('list-glossary: rejects mismatched workspace', async () => {
    const h = getHandler('list-glossary');
    const result = await h({ workspaceId: OTHER_WS });
    expect(result.content[0]?.text).toMatch(/access denied/i);
    expect(result.content[0]?.text).toContain(OTHER_WS);
  });

  it('list-entities: allows the authenticated workspace', async () => {
    const h = getHandler('list-entities');
    const result = await h({ entityType: 'deal', workspaceId: AUTHED_WS, limit: 5, contextBudget: 2000 });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('No entities of type "deal"');
  });

  it('get-entity: allows the authenticated workspace', async () => {
    const h = getHandler('get-entity');
    const result = await h({ id: 'hubspot:contact:99', workspaceId: AUTHED_WS });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('not found');
  });

  it('get-metric: allows the authenticated workspace', async () => {
    const h = getHandler('get-metric');
    const result = await h({ metricId: 'churn_rate', workspaceId: AUTHED_WS });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('not defined');
  });

  it('list-glossary: allows the authenticated workspace', async () => {
    const h = getHandler('list-glossary');
    const result = await h({ workspaceId: AUTHED_WS });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('No glossary terms');
  });
});

// ─── Pagination — list-entities ─────────────────────────────────────────────

function makeEntity(id: string, ts: string) {
  return { id, type: 'contact', label: `Contact ${id}`, attributes: {}, relationships: [], lastModified: new Date(ts), sourceId: id };
}

describe('list-entities pagination', () => {
  it('returns nextCursor when more results exist', async () => {
    const { server, getHandler } = makeMockServer();
    const ts = '2026-01-02T00:00:00.000Z';
    // Return 6 results when 5 were requested (pageSize + 1 sentinel)
    const entities = Array.from({ length: 6 }, (_, i) => makeEntity(`e${i}`, ts));
    const vs = { ...makeVectorStore(), listByType: vi.fn().mockResolvedValue(entities) } as unknown as VectorStore;
    registerListEntities(server, vs, null);
    const result = await getHandler('list-entities')({ entityType: 'contact', workspaceId: 'ws', limit: 5, contextBudget: 2000 });
    expect(result.content[0]?.text).toContain('[nextCursor:');
    expect((result as { nextCursor?: string }).nextCursor).toBe(ts);
    // Only 5 entities in the page (not 6)
    expect(vs.listByType).toHaveBeenCalledWith('ws', 'contact', 6, undefined);
  });

  it('does not return nextCursor when all results fit in one page', async () => {
    const { server, getHandler } = makeMockServer();
    const entities = Array.from({ length: 3 }, (_, i) => makeEntity(`e${i}`, '2026-01-01T00:00:00.000Z'));
    const vs = { ...makeVectorStore(), listByType: vi.fn().mockResolvedValue(entities) } as unknown as VectorStore;
    registerListEntities(server, vs, null);
    const result = await getHandler('list-entities')({ entityType: 'contact', workspaceId: 'ws', limit: 5, contextBudget: 2000 });
    expect(result.content[0]?.text).not.toContain('[nextCursor:');
    expect((result as { nextCursor?: string }).nextCursor).toBeUndefined();
  });

  it('passes cursor to vectorStore when provided', async () => {
    const { server, getHandler } = makeMockServer();
    const vs = { ...makeVectorStore(), listByType: vi.fn().mockResolvedValue([]) } as unknown as VectorStore;
    registerListEntities(server, vs, null);
    const cursor = '2026-01-01T12:00:00.000Z';
    await getHandler('list-entities')({ entityType: 'deal', workspaceId: 'ws', limit: 10, cursor, contextBudget: 2000 });
    expect(vs.listByType).toHaveBeenCalledWith('ws', 'deal', 11, cursor);
  });

  it('clamps limit to MAX_PAGE_SIZE (100)', async () => {
    const { server, getHandler } = makeMockServer();
    const vs = { ...makeVectorStore(), listByType: vi.fn().mockResolvedValue([]) } as unknown as VectorStore;
    registerListEntities(server, vs, null);
    // limit of 200 should be clamped to 100
    await getHandler('list-entities')({ entityType: 'deal', workspaceId: 'ws', limit: 100, contextBudget: 2000 });
    expect(vs.listByType).toHaveBeenCalledWith('ws', 'deal', 101, undefined);
  });
});

// ─── Pagination — list-glossary ──────────────────────────────────────────────

function makeTerm(term: string) {
  return { id: term, workspaceId: 'ws', term, definition: `Def of ${term}`, exampleValue: null, status: 'approved', approvedBy: null, approvedAt: null, usageCount: 0, createdAt: new Date(), updatedAt: new Date() };
}

describe('list-glossary pagination', () => {
  it('returns nextCursor when more terms exist', async () => {
    const { server, getHandler } = makeMockServer();
    const terms = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map(makeTerm);
    const gs = { ...makeGlossaryService(), listTerms: vi.fn().mockResolvedValue(ok(terms)) } as unknown as GlossaryService;
    registerListGlossary(server, gs, null);
    const result = await getHandler('list-glossary')({ workspaceId: 'ws', limit: 5 });
    expect(result.content[0]?.text).toContain('[nextCursor:');
    expect((result as { nextCursor?: string }).nextCursor).toBe('epsilon');
    expect(gs.listTerms).toHaveBeenCalledWith('ws', undefined, undefined, 6, undefined);
  });

  it('does not return nextCursor when all terms fit in one page', async () => {
    const { server, getHandler } = makeMockServer();
    const terms = ['alpha', 'beta'].map(makeTerm);
    const gs = { ...makeGlossaryService(), listTerms: vi.fn().mockResolvedValue(ok(terms)) } as unknown as GlossaryService;
    registerListGlossary(server, gs, null);
    const result = await getHandler('list-glossary')({ workspaceId: 'ws', limit: 5 });
    expect(result.content[0]?.text).not.toContain('[nextCursor:');
    expect((result as { nextCursor?: string }).nextCursor).toBeUndefined();
  });

  it('passes cursor to glossaryService when provided', async () => {
    const { server, getHandler } = makeMockServer();
    const gs = { ...makeGlossaryService(), listTerms: vi.fn().mockResolvedValue(ok([])) } as unknown as GlossaryService;
    registerListGlossary(server, gs, null);
    await getHandler('list-glossary')({ workspaceId: 'ws', limit: 10, cursor: 'gamma' });
    expect(gs.listTerms).toHaveBeenCalledWith('ws', undefined, undefined, 11, 'gamma');
  });

  it('includes filter when provided alongside cursor', async () => {
    const { server, getHandler } = makeMockServer();
    const gs = { ...makeGlossaryService(), listTerms: vi.fn().mockResolvedValue(ok([])) } as unknown as GlossaryService;
    registerListGlossary(server, gs, null);
    await getHandler('list-glossary')({ workspaceId: 'ws', limit: 20, filter: 'rev', cursor: 'revenue' });
    expect(gs.listTerms).toHaveBeenCalledWith('ws', 'rev', undefined, 21, 'revenue');
  });
});

// ─── Dev mode (null workspace — all pass) ────────────────────────────────────

describe('workspace isolation (dev mode — null)', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;

  beforeEach(() => {
    const mock = makeMockServer();
    server = mock.server;
    getHandler = mock.getHandler;

    registerListEntities(server, makeVectorStore(), null);
    registerGetEntity(server, makeVectorStore(), null);
    registerGetMetric(server, makeMetricRegistry(), null);
    registerListGlossary(server, makeGlossaryService(), null);
  });

  it('list-entities: allows any workspace in dev mode', async () => {
    const h = getHandler('list-entities');
    const result = await h({ entityType: 'contact', workspaceId: 'any-ws', limit: 10, contextBudget: 2000 });
    expect(result.isError).toBeFalsy();
  });

  it('get-entity: allows any workspace in dev mode', async () => {
    const h = getHandler('get-entity');
    const result = await h({ id: 'x:y:z', workspaceId: 'any-ws' });
    expect(result.isError).toBeFalsy();
  });

  it('list-glossary: allows any workspace in dev mode', async () => {
    const h = getHandler('list-glossary');
    const result = await h({ workspaceId: 'any-ws' });
    expect(result.isError).toBeFalsy();
  });

  it('get-metric: allows any workspace in dev mode', async () => {
    const h = getHandler('get-metric');
    const result = await h({ metricId: 'arpu', workspaceId: 'any-ws' });
    expect(result.isError).toBeFalsy();
  });
});
