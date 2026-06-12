import { describe, it, expect, vi } from 'vitest';
import { resolveWorkspace, assertWorkspace } from '../workspace-guard.js';
import { registerTool } from '../register-tool.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// resolveWorkspace
// ---------------------------------------------------------------------------

describe('resolveWorkspace', () => {
  describe('authenticated mode (key has workspace)', () => {
    const AUTH_WS = 'ws-abc-123';

    it('defaults to the key workspace when caller omits workspaceId', () => {
      const result = resolveWorkspace(undefined, AUTH_WS);
      expect(result).toEqual({ workspaceId: AUTH_WS });
    });

    it('accepts an explicit workspaceId that matches the key', () => {
      const result = resolveWorkspace(AUTH_WS, AUTH_WS);
      expect(result).toEqual({ workspaceId: AUTH_WS });
    });

    it('returns an error when caller provides a mismatched workspaceId', () => {
      const result = resolveWorkspace('ws-other', AUTH_WS);
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/Access denied/);
      expect((result as { error: string }).error).toContain('ws-other');
    });
  });

  describe('unauthenticated dev mode (no API key)', () => {
    it('returns an error when no workspaceId is provided', () => {
      const result = resolveWorkspace(undefined, null);
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/required.*unauthenticated/i);
    });

    it('accepts any explicit workspaceId', () => {
      const result = resolveWorkspace('ws-dev-001', null);
      expect(result).toEqual({ workspaceId: 'ws-dev-001' });
    });
  });
});

// ---------------------------------------------------------------------------
// assertWorkspace (kept for backward compat)
// ---------------------------------------------------------------------------

describe('assertWorkspace', () => {
  it('returns null when authenticated workspace matches', () => {
    expect(assertWorkspace('ws-abc', 'ws-abc')).toBeNull();
  });

  it('returns error string when workspaces differ', () => {
    const err = assertWorkspace('ws-other', 'ws-abc');
    expect(err).toMatch(/Access denied/);
  });

  it('returns null when authenticatedId is null (dev mode — all workspaces permitted)', () => {
    expect(assertWorkspace('any-workspace', null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// registerTool workspace middleware
// ---------------------------------------------------------------------------

describe('registerTool workspace middleware', () => {
  function makeMockServer() {
    const registered: Array<{ name: string; handler: (input: Record<string, unknown>) => unknown }> = [];
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>) => unknown,
      ) => {
        registered.push({ name, handler });
      },
      _registered: registered,
    } as unknown as McpServer & { _registered: typeof registered };
    return server;
  }

  it('injects authenticated workspaceId when input omits it', async () => {
    const server = makeMockServer();
    const mockHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    registerTool(server, 'test-tool', { authenticatedWorkspaceId: 'ws-abc' }, mockHandler);

    const { handler } = (server as ReturnType<typeof makeMockServer>)._registered[0];
    await handler({ query: 'hello' });

    expect(mockHandler).toHaveBeenCalledWith({ query: 'hello', workspaceId: 'ws-abc' });
  });

  it('passes through when input workspaceId matches authenticated workspace', async () => {
    const server = makeMockServer();
    const mockHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    registerTool(server, 'test-tool', { authenticatedWorkspaceId: 'ws-abc' }, mockHandler);

    const { handler } = (server as ReturnType<typeof makeMockServer>)._registered[0];
    await handler({ query: 'hello', workspaceId: 'ws-abc' });

    expect(mockHandler).toHaveBeenCalledWith({ query: 'hello', workspaceId: 'ws-abc' });
  });

  it('returns structured error when input workspaceId mismatches authenticated workspace', async () => {
    const server = makeMockServer();
    const mockHandler = vi.fn();

    registerTool(server, 'test-tool', { authenticatedWorkspaceId: 'ws-abc' }, mockHandler);

    const { handler } = (server as ReturnType<typeof makeMockServer>)._registered[0];
    const result = await handler({ query: 'hello', workspaceId: 'ws-other' }) as { content: Array<{ type: string; text: string }> };

    expect(mockHandler).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/Access denied/);
  });

  it('returns structured error in dev mode when workspaceId is omitted', async () => {
    const server = makeMockServer();
    const mockHandler = vi.fn();

    registerTool(server, 'test-tool', { authenticatedWorkspaceId: null }, mockHandler);

    const { handler } = (server as ReturnType<typeof makeMockServer>)._registered[0];
    const result = await handler({ query: 'hello' }) as { content: Array<{ type: string; text: string }> };

    expect(mockHandler).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/required.*unauthenticated/i);
  });

  it('does not wrap handler when authenticatedWorkspaceId is not in config (legacy tools)', async () => {
    const server = makeMockServer();
    const mockHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    registerTool(server, 'test-tool', {}, mockHandler);

    const { handler } = (server as ReturnType<typeof makeMockServer>)._registered[0];
    await handler({ query: 'hello' });

    expect(mockHandler).toHaveBeenCalledWith({ query: 'hello' });
  });
});
