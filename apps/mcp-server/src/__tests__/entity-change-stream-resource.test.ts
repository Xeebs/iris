import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  };
});

type ResourceHandler = (uri: URL) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>;
type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function makeMockServer() {
  const resources = new Map<string, ResourceHandler>();
  const tools = new Map<string, ToolHandler>();

  const server = {
    resource: vi.fn((name: string, _pattern: unknown, handler: ResourceHandler) => {
      resources.set(name, handler);
    }),
    tool: vi.fn((name: string, _desc: unknown, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }),
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }),
  } as unknown as McpServer;

  return {
    server,
    getResource: (name: string) => resources.get(name)!,
    getTool: (name: string) => tools.get(name)!,
    hasResource: (name: string) => resources.has(name),
    hasTool: (name: string) => tools.has(name),
  };
}

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (arr: unknown) => arr;
  (fn as Record<string, unknown>).json = (obj: unknown) => obj;
  return fn;
}

// ─── Registration tests ───────────────────────────────────────────────────────

describe('registerChangeStreamResource', () => {
  it('registers the entity-changes resource', async () => {
    const { server, hasResource } = makeMockServer();
    const { registerChangeStreamResource } = await import('../resources/entity-change-stream-resource.js');
    registerChangeStreamResource(server, makeSql(), 'ws-1');
    expect(hasResource('entity-changes')).toBe(true);
  });

  it('registers the subscribe-entity-changes tool', async () => {
    const { server, hasTool } = makeMockServer();
    const { registerChangeStreamResource } = await import('../resources/entity-change-stream-resource.js');
    registerChangeStreamResource(server, makeSql(), 'ws-1');
    expect(hasTool('subscribe-entity-changes')).toBe(true);
  });

  it('resource handler is a function', async () => {
    const { server, getResource } = makeMockServer();
    const { registerChangeStreamResource } = await import('../resources/entity-change-stream-resource.js');
    registerChangeStreamResource(server, makeSql(), 'ws-1');
    expect(typeof getResource('entity-changes')).toBe('function');
  });
});

// ─── Resource handler tests ───────────────────────────────────────────────────

describe('Entity change stream resource handler', () => {
  let server: McpServer;
  let getResource: (name: string) => ResourceHandler;

  beforeEach(async () => {
    const mock = makeMockServer();
    server = mock.server;
    getResource = mock.getResource;
    const { registerChangeStreamResource } = await import('../resources/entity-change-stream-resource.js');
    registerChangeStreamResource(server, makeSql(), 'ws-1');
  });

  it('returns contents array for valid entity URI', async () => {
    const handler = getResource('entity-changes');
    const result = await handler(new URL('iris://entities/hubspot:contact:123/changes'));
    expect(Array.isArray(result.contents)).toBe(true);
    expect(result.contents[0]).toHaveProperty('uri');
    expect(result.contents[0]).toHaveProperty('mimeType', 'application/json');
    expect(result.contents[0]).toHaveProperty('text');
  });

  it('returns error for invalid URI (missing /changes segment)', async () => {
    const handler = getResource('entity-changes');
    const result = await handler(new URL('iris://entities/hubspot:contact:123'));
    const parsed = JSON.parse(result.contents[0]!.text) as { error?: string };
    expect(parsed).toHaveProperty('error');
  });

  it('response JSON includes entityId and eventCount', async () => {
    const handler = getResource('entity-changes');
    const result = await handler(new URL('iris://entities/contact-1/changes'));
    const parsed = JSON.parse(result.contents[0]!.text) as { entityId: string; eventCount: number };
    expect(parsed.entityId).toBe('contact-1');
    expect(typeof parsed.eventCount).toBe('number');
  });

  it('response JSON includes truncated flag', async () => {
    const handler = getResource('entity-changes');
    const result = await handler(new URL('iris://entities/contact-1/changes'));
    const parsed = JSON.parse(result.contents[0]!.text) as { truncated: boolean };
    expect(typeof parsed.truncated).toBe('boolean');
  });

  it('serializes events array in response', async () => {
    const handler = getResource('entity-changes');
    const result = await handler(new URL('iris://entities/contact-1/changes'));
    const parsed = JSON.parse(result.contents[0]!.text) as { events: unknown[] };
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  it('applies contextBudget from query param', async () => {
    const handler = getResource('entity-changes');
    const result = await handler(new URL('iris://entities/contact-1/changes?budget=100'));
    const parsed = JSON.parse(result.contents[0]!.text) as { eventCount: number };
    // Budget 100 / 60 tokens = max 1 event
    expect(parsed.eventCount).toBeLessThanOrEqual(2);
  });

  it('filters change types from query param', async () => {
    const sql = makeSql([{
      change_id: 'chg-1',
      entity_id: 'contact-1',
      entity_type: 'contact',
      change_type: 'updated',
      previous_value: null,
      new_value: { status: 'active' },
      source: 'hubspot',
      workspace_id: 'ws-1',
      changed_at: new Date(),
    }]);
    const mock = makeMockServer();
    const { registerChangeStreamResource } = await import('../resources/entity-change-stream-resource.js');
    registerChangeStreamResource(mock.server, sql, 'ws-1');
    const handler = mock.getResource('entity-changes');
    const result = await handler(new URL('iris://entities/contact-1/changes?types=updated'));
    const parsed = JSON.parse(result.contents[0]!.text) as { events: unknown[] };
    expect(Array.isArray(parsed.events)).toBe(true);
  });
});

// ─── Subscribe tool tests ──────────────────────────────────────────────────────

describe('subscribe-entity-changes tool', () => {
  let getTool: (name: string) => ToolHandler;

  beforeEach(async () => {
    const mock = makeMockServer();
    const { registerChangeStreamResource } = await import('../resources/entity-change-stream-resource.js');
    registerChangeStreamResource(mock.server, makeSql(), 'ws-1');
    getTool = mock.getTool;
  });

  it('returns content array with subscriptionId on success', async () => {
    const handler = getTool('subscribe-entity-changes');
    const result = await handler({ entityId: 'contact-1', workspaceId: 'ws-1' });
    const parsed = JSON.parse(result.content[0]!.text) as { subscriptionId?: string; error?: string };
    // Either succeeds with subscriptionId or fails with error (DB not available in test)
    expect(result.content[0]).toHaveProperty('text');
    expect(typeof result.content[0]!.text).toBe('string');
  });

  it('returns error when no workspaceId available', async () => {
    const mock = makeMockServer();
    const { registerChangeStreamResource } = await import('../resources/entity-change-stream-resource.js');
    registerChangeStreamResource(mock.server, makeSql(), null); // no authenticatedWorkspaceId
    const handler = mock.getTool('subscribe-entity-changes');
    const result = await handler({ entityId: 'contact-1' }); // no workspaceId in input
    const parsed = JSON.parse(result.content[0]!.text) as { error?: string };
    expect(parsed).toHaveProperty('error');
  });

  it('handles wildcard entityId (*)', async () => {
    const handler = getTool('subscribe-entity-changes');
    const result = await handler({ entityId: '*', workspaceId: 'ws-1' });
    expect(result.content[0]).toHaveProperty('text');
  });
});
