import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { contextDeltasRouter } from '../routes/context-deltas';

vi.mock('@iris/semantic-core/context-delta-streamer', () => ({
  getClientContextState: vi.fn(),
  resetClientState: vi.fn(),
  getDeltaHistory: vi.fn(),
}));

import {
  getClientContextState,
  resetClientState,
  getDeltaHistory,
} from '@iris/semantic-core/context-delta-streamer';
import { ok, err } from 'neverthrow';

const mockGetState = vi.mocked(getClientContextState);
const mockReset = vi.mocked(resetClientState);
const mockGetHistory = vi.mocked(getDeltaHistory);

function buildApp() {
  const app = new Hono();
  app.route('/mcp-clients', contextDeltasRouter);
  return app;
}

function req(method: string, path: string, opts: { headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'x-workspace-id': 'ws-test', ...(opts.headers ?? {}) },
  });
}

describe('GET /mcp-clients/:clientId/state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with context state when found', async () => {
    const state = {
      clientId: 'c1', workspaceId: 'ws-test',
      lastQueryHash: 'hash', lastContextSnapshot: 'snap',
      entitiesServed: ['e1'], snapshotCreatedAt: new Date(), expiresAt: new Date(),
    };
    mockGetState.mockResolvedValue(ok(state));

    const res = await buildApp().fetch(req('GET', '/mcp-clients/c1/state'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof state };
    expect(body.data.clientId).toBe('c1');
  });

  it('returns 404 when client has no state', async () => {
    mockGetState.mockResolvedValue(ok(null));
    const res = await buildApp().fetch(req('GET', '/mcp-clients/c1/state'));
    expect(res.status).toBe(404);
  });

  it('returns 500 on DB error', async () => {
    mockGetState.mockResolvedValue(err(new Error('DB fail')));
    const res = await buildApp().fetch(req('GET', '/mcp-clients/c1/state'));
    expect(res.status).toBe(500);
  });
});

describe('GET /mcp-clients/:clientId/context-history', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with paginated history', async () => {
    const entries = [
      { clientId: 'c1', deltaId: 'd1', entitiesAddedCount: 2, entitiesRemovedCount: 0, entitiesModifiedCount: 1, savedTokens: 100, streamChunks: 1, deliveredAt: new Date() },
    ];
    mockGetHistory.mockResolvedValue(ok({ entries, nextCursor: null }));

    const res = await buildApp().fetch(req('GET', '/mcp-clients/c1/context-history'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof entries; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.hasMore).toBe(false);
  });

  it('passes cursor and limit to service', async () => {
    mockGetHistory.mockResolvedValue(ok({ entries: [], nextCursor: null }));
    const res = await buildApp().fetch(req('GET', '/mcp-clients/c1/context-history?limit=5&cursor=abc'));
    expect(res.status).toBe(200);
    expect(mockGetHistory).toHaveBeenCalledWith(undefined, 'c1', 'ws-test', 5, 'abc');
  });

  it('returns nextCursor in meta when hasMore', async () => {
    mockGetHistory.mockResolvedValue(ok({ entries: [], nextCursor: 'next-cursor-id' }));
    const res = await buildApp().fetch(req('GET', '/mcp-clients/c1/context-history'));
    const body = await res.json() as { meta: { hasMore: boolean; nextCursor: string } };
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBe('next-cursor-id');
  });

  it('returns 500 on service error', async () => {
    mockGetHistory.mockResolvedValue(err(new Error('DB error')));
    const res = await buildApp().fetch(req('GET', '/mcp-clients/c1/context-history'));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /mcp-clients/:clientId/state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with reset confirmation', async () => {
    mockReset.mockResolvedValue(ok(undefined));
    const res = await buildApp().fetch(req('DELETE', '/mcp-clients/c1/state'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reset: boolean; clientId: string } };
    expect(body.data.reset).toBe(true);
    expect(body.data.clientId).toBe('c1');
  });

  it('returns 500 when reset fails', async () => {
    mockReset.mockResolvedValue(err(new Error('fail')));
    const res = await buildApp().fetch(req('DELETE', '/mcp-clients/c1/state'));
    expect(res.status).toBe(500);
  });
});
