import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDataLineageRoutes } from '../routes/data-lineage.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/data-lineage', () => {
  const mock = {
    getLineage: vi.fn(),
    getLineageGraph: vi.fn(),
    computeImpact: vi.fn(),
    listEntityLineage: vi.fn(),
    recordOrigin: vi.fn(),
    addTransformation: vi.fn(),
    recordOriginBatch: vi.fn(),
    recordDependency: vi.fn(),
  };
  return {
    DataLineageService: vi.fn(() => mock),
    _mock: mock,
  };
});

import { _mock as mockSvc } from '@iris/semantic-core/data-lineage';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createDataLineageRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/', createDataLineageRoutes(sqlMock));
  return app;
}

beforeEach(() => vi.clearAllMocks());

const lineageFixture = {
  entityId: 'hubspot:contact:1',
  workspaceId: 'ws-test',
  sourceConnectorId: 'hubspot',
  sourceSyncJobId: 'job-abc',
  transformations: [{ type: 'embedding', timestamp: '2026-01-01T00:00:00Z' }],
  lastModifiedBy: 'system',
  lastModifiedAt: new Date('2026-01-01T00:00:00Z'),
};

const graphFixture = {
  entityId: 'hubspot:contact:1',
  ancestors: [{ entityId: 'hubspot:company:1', depth: 1, relationshipType: 'derived_from' }],
  descendants: [{ entityId: 'salesforce:deal:1', depth: 1, relationshipType: 'references' }],
};

const impactFixture = {
  entityId: 'hubspot:contact:1',
  affectedEntityIds: ['deal:1', 'deal:2'],
  depth: 3,
  affectedCount: 2,
};

describe('GET /entities/:id/lineage', () => {
  it('returns lineage record', async () => {
    mockSvc.getLineage.mockResolvedValueOnce(lineageFixture);
    const res = await makeApp().request('/entities/hubspot:contact:1/lineage');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof lineageFixture };
    expect(body.data.entityId).toBe('hubspot:contact:1');
    expect(body.data.sourceConnectorId).toBe('hubspot');
  });

  it('returns 404 when no lineage exists', async () => {
    mockSvc.getLineage.mockResolvedValueOnce(null);
    const res = await makeApp().request('/entities/unknown:1/lineage');
    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockSvc.getLineage.mockRejectedValueOnce(new Error('db timeout'));
    const res = await makeApp().request('/entities/e1/lineage');
    expect(res.status).toBe(500);
  });
});

describe('GET /entities/:id/lineage-graph', () => {
  it('returns lineage graph', async () => {
    mockSvc.getLineageGraph.mockResolvedValueOnce(ok(graphFixture));
    const res = await makeApp().request('/entities/hubspot:contact:1/lineage-graph');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof graphFixture };
    expect(body.data.ancestors).toHaveLength(1);
    expect(body.data.descendants).toHaveLength(1);
  });

  it('returns 500 on error', async () => {
    mockSvc.getLineageGraph.mockResolvedValueOnce(err(new Error('graph error')));
    const res = await makeApp().request('/entities/e1/lineage-graph');
    expect(res.status).toBe(500);
  });
});

describe('GET /entities/:id/impact', () => {
  it('returns impact analysis', async () => {
    mockSvc.computeImpact.mockResolvedValueOnce(ok(impactFixture));
    const res = await makeApp().request('/entities/hubspot:contact:1/impact');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof impactFixture };
    expect(body.data.affectedCount).toBe(2);
    expect(body.data.affectedEntityIds).toContain('deal:1');
  });

  it('returns 500 on error', async () => {
    mockSvc.computeImpact.mockResolvedValueOnce(err(new Error('traversal error')));
    const res = await makeApp().request('/entities/e1/impact');
    expect(res.status).toBe(500);
  });
});

describe('POST /lineage/change-impact', () => {
  it('simulates change impact', async () => {
    mockSvc.computeImpact.mockResolvedValueOnce(ok(impactFixture));
    const res = await makeApp().request('/lineage/change-impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: 'hubspot:contact:1', changeType: 'delete', maxDepth: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { changeType: string; affectedCount: number } };
    expect(body.data.changeType).toBe('delete');
    expect(body.data.affectedCount).toBe(2);
  });

  it('returns 400 on missing entityId', async () => {
    const res = await makeApp().request('/lineage/change-impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeType: 'delete' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /lineage', () => {
  it('returns paginated lineage list', async () => {
    mockSvc.listEntityLineage.mockResolvedValueOnce([lineageFixture, lineageFixture]);
    const res = await makeApp().request('/lineage?limit=50');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(2);
    expect(body.meta.hasMore).toBe(false);
  });

  it('sets hasMore=true when results equal limit', async () => {
    mockSvc.listEntityLineage.mockResolvedValueOnce(Array(2).fill(lineageFixture));
    const res = await makeApp().request('/lineage?limit=2');
    expect(res.status).toBe(200);
    const body = await res.json() as { meta: { hasMore: boolean; nextCursor?: string } };
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBeDefined();
  });

  it('returns 500 on db error', async () => {
    mockSvc.listEntityLineage.mockRejectedValueOnce(new Error('db fail'));
    const res = await makeApp().request('/lineage');
    expect(res.status).toBe(500);
  });
});
