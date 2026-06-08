import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createEntityLinkingRoutes } from '../routes/entity-linking.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/entity-linker', () => {
  const mockLinker = {
    listLinks: vi.fn(),
    analyzeEntityConnections: vi.fn(),
    updateLinkStatus: vi.fn(),
    confirmMerge: vi.fn(),
    undoMerge: vi.fn(),
    getMergeHistory: vi.fn(),
  };
  return {
    EntityLinker: vi.fn(() => mockLinker),
    _mockLinker: mockLinker,
  };
});

import { _mockLinker as mockLinker } from '@iris/semantic-core/entity-linker';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createEntityLinkingRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/', createEntityLinkingRoutes(sqlMock));
  return app;
}

const linkFixture = {
  id: 'link-1', workspaceId: 'ws-test',
  entityIdA: 'hubspot:contact:1', connectorA: 'hubspot',
  entityIdB: 'slack:user:U1', connectorB: 'slack',
  confidence: 0.87,
  matchSignals: { compositeScore: 0.87 },
  status: 'proposed' as const,
  createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /suggestions', () => {
  it('returns list of pending link suggestions', async () => {
    mockLinker.listLinks.mockResolvedValueOnce(ok([linkFixture]));
    const app = makeApp();
    const res = await app.request('/suggestions');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('always queries with proposed status', async () => {
    mockLinker.listLinks.mockResolvedValueOnce(ok([]));
    const app = makeApp();
    await app.request('/suggestions');
    expect(mockLinker.listLinks).toHaveBeenCalledWith('ws-test', 'proposed', 50);
  });

  it('returns 500 on service error', async () => {
    mockLinker.listLinks.mockResolvedValueOnce(err(new Error('db error')));
    const app = makeApp();
    const res = await app.request('/suggestions');
    expect(res.status).toBe(500);
  });
});

describe('POST /analyze', () => {
  it('triggers analysis and returns 201 with proposal count', async () => {
    mockLinker.analyzeEntityConnections.mockResolvedValueOnce(ok(5));
    const app = makeApp();
    const res = await app.request('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'contact', threshold: 0.75 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { proposalsCreated: number } };
    expect(body.data.proposalsCreated).toBe(5);
  });

  it('uses defaults when body is empty', async () => {
    mockLinker.analyzeEntityConnections.mockResolvedValueOnce(ok(0));
    const app = makeApp();
    await app.request('/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(mockLinker.analyzeEntityConnections).toHaveBeenCalledWith('ws-test', undefined, 0.70);
  });

  it('returns 400 for invalid threshold', async () => {
    const app = makeApp();
    const res = await app.request('/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: 5 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /links/:id', () => {
  it('confirms a link', async () => {
    mockLinker.updateLinkStatus.mockResolvedValueOnce(ok({ ...linkFixture, status: 'confirmed' }));
    const app = makeApp();
    const res = await app.request('/links/link-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when link not found', async () => {
    mockLinker.updateLinkStatus.mockResolvedValueOnce(err(new Error('Link not found')));
    const app = makeApp();
    const res = await app.request('/links/bad', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /merge', () => {
  it('confirms a merge and returns 201 with mergeId', async () => {
    mockLinker.confirmMerge.mockResolvedValueOnce(ok('merge-uuid'));
    const app = makeApp();
    const res = await app.request('/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceEntityId: 'e-a', targetEntityId: 'e-b', mergedBy: 'user-1' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { mergeId: string } };
    expect(body.data.mergeId).toBe('merge-uuid');
  });

  it('returns 400 when sourceEntityId missing', async () => {
    const app = makeApp();
    const res = await app.request('/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetEntityId: 'e-b' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on merge failure', async () => {
    mockLinker.confirmMerge.mockResolvedValueOnce(err(new Error('not found')));
    const app = makeApp();
    const res = await app.request('/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceEntityId: 'e-a', targetEntityId: 'e-b' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /merges/:mergeId', () => {
  it('undoes a merge and returns ok', async () => {
    mockLinker.undoMerge.mockResolvedValueOnce(ok(undefined));
    const app = makeApp();
    const res = await app.request('/merges/m-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { undone: boolean } };
    expect(body.data.undone).toBe(true);
  });
});

describe('GET /history', () => {
  it('returns merge history', async () => {
    mockLinker.getMergeHistory.mockResolvedValueOnce(ok([
      { mergeId: 'm-1', workspaceId: 'ws-test', sourceEntityId: 'e-a', targetEntityId: 'e-b', mergedBy: 'u-1', mergedAt: new Date(), undoneAt: undefined },
    ]));
    const app = makeApp();
    const res = await app.request('/history');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});
