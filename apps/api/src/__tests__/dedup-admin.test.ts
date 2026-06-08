import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDedupAdminRoutes } from '../routes/dedup-admin.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const mockCluster = {
  clusterId: 'cl1',
  workspaceId: 'ws1',
  entityType: 'contact',
  memberCount: 2,
  canonicalEntityId: 'e1',
  avgSimilarity: 0.91,
  members: [],
  createdAt: new Date('2026-01-01'),
  mergedAt: null,
};

const mockDecision = {
  workspaceId: 'ws1',
  sourceEntityId: 'e1',
  targetEntityId: 'e2',
  confidenceScore: 0.91,
  attributesCompared: [],
  mergeStatus: 'approved' as const,
  reviewedByUserId: 'user1',
  createdAt: new Date('2026-01-01'),
};

vi.mock('@iris/semantic-core/dedup-inspector', () => ({
  DedupInspector: vi.fn().mockImplementation(() => ({
    analyzeDedupClusters: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: [mockCluster] }),
    approveMerge: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: mockDecision }),
  })),
}));

function makeApp() {
  const sql = vi.fn().mockResolvedValue([]);
  const app = new Hono();
  app.route('/api/v1/admin/dedup', createDedupAdminRoutes(sql as never));
  return { app, sql };
}

describe('GET /api/v1/admin/dedup/clusters', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it('returns 200 with cluster list', async () => {
    const res = await app.request('/api/v1/admin/dedup/clusters', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof mockCluster[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]!.clusterId).toBe('cl1');
  });

  it('passes entityType filter from query param', async () => {
    const res = await app.request('/api/v1/admin/dedup/clusters?entityType=contact', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 500 when inspector fails', async () => {
    const { DedupInspector } = await import('@iris/semantic-core/dedup-inspector');
    vi.mocked(DedupInspector).mockImplementationOnce(() => ({
      analyzeDedupClusters: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('db down') }),
      compareEntities: vi.fn(),
      suggestMerge: vi.fn(),
      approveMerge: vi.fn(),
      explainDedupDecision: vi.fn(),
    }));

    const sql = vi.fn().mockResolvedValue([]);
    const app2 = new Hono();
    app2.route('/api/v1/admin/dedup', createDedupAdminRoutes(sql as never));

    const res = await app2.request('/api/v1/admin/dedup/clusters', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/admin/dedup/clusters/:clusterId/members', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it('returns 200 with cluster members', async () => {
    const res = await app.request('/api/v1/admin/dedup/clusters/cl1/members', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { clusterId: string } };
    expect(body.meta.clusterId).toBe('cl1');
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 404 for unknown cluster ID', async () => {
    const res = await app.request('/api/v1/admin/dedup/clusters/unknown-id/members', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/admin/dedup/merge', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it('returns 201 with approved decision', async () => {
    const res = await app.request('/api/v1/admin/dedup/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1', 'x-user-id': 'user1' },
      body: JSON.stringify({ entity1Id: 'e1', entity2Id: 'e2', canonicalId: 'e1' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof mockDecision };
    expect(body.data.mergeStatus).toBe('approved');
  });

  it('returns 400 for missing entity IDs', async () => {
    const res = await app.request('/api/v1/admin/dedup/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ entity1Id: 'e1' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for empty body', async () => {
    const res = await app.request('/api/v1/admin/dedup/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when merge fails', async () => {
    const { DedupInspector } = await import('@iris/semantic-core/dedup-inspector');
    vi.mocked(DedupInspector).mockImplementationOnce(() => ({
      analyzeDedupClusters: vi.fn(),
      compareEntities: vi.fn(),
      suggestMerge: vi.fn(),
      approveMerge: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('merge error') }),
      explainDedupDecision: vi.fn(),
    }));

    const sql = vi.fn().mockResolvedValue([]);
    const app2 = new Hono();
    app2.route('/api/v1/admin/dedup', createDedupAdminRoutes(sql as never));

    const res = await app2.request('/api/v1/admin/dedup/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ entity1Id: 'e1', entity2Id: 'e2', canonicalId: 'e1' }),
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('MERGE_FAILED');
  });
});

describe('GET /api/v1/admin/dedup/entities/:entityId/dedup-status', () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it('returns dedup status for an entity in a cluster', async () => {
    const res = await app.request('/api/v1/admin/dedup/entities/e1/dedup-status', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { isPartOfCluster: boolean; isCanonical: boolean } };
    expect(body.data.isPartOfCluster).toBe(true);
    expect(body.data.isCanonical).toBe(true);
  });

  it('returns not-in-cluster for unknown entity', async () => {
    const res = await app.request('/api/v1/admin/dedup/entities/unknown-entity/dedup-status', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { isPartOfCluster: boolean } };
    expect(body.data.isPartOfCluster).toBe(false);
  });
});
