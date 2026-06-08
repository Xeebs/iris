import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createAdminIndexRoutes } from '../routes/admin-index.js';

vi.mock('@iris/semantic-core/index-maintenance', () => {
  const makeHealthReport = () => ({
    workspaceId: 'ws-1',
    totalEntities: 500,
    vectorStoreSize: 3072000,
    orphanedEntities: 5,
    duplicateEstimate: 15,
    staleEntities: 20,
    lastMaintenanceAt: new Date('2026-06-01'),
    healthScore: 95,
  });

  const mockSvc = {
    listJobs: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: [] }),
    deduplicateIndex: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: { scanned: 10, mergedGroups: 2, entitiesRemoved: 2 } }),
    pruneStaleEntities: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: { scanned: 5, pruned: 5, bytesFreed: 30720 } }),
    rebalanceVectorIndex: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: undefined }),
    validateIndexIntegrity: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: { orphanedEntities: 0, brokenRelationships: 0, missingEmbeddings: 0, repaired: 0 } }),
    getIndexHealth: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: makeHealthReport() }),
  };

  return {
    IndexMaintenanceService: vi.fn().mockImplementation(() => mockSvc),
  };
});

type MockSql = ReturnType<typeof import('postgres').default>;
const mockSql = {} as MockSql;

function buildApp() {
  const app = new Hono();
  app.route('/admin/index', createAdminIndexRoutes(mockSql));
  return app;
}

describe('GET /admin/index/maintenance', () => {
  it('returns 400 without workspaceId', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/maintenance');
    expect(res.status).toBe(400);
  });

  it('returns jobs list', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/maintenance?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('passes limit param', async () => {
    const { IndexMaintenanceService } = await import('@iris/semantic-core/index-maintenance');
    const app = buildApp();
    await app.request('/admin/index/maintenance?workspaceId=ws-1&limit=10');
    const instance = vi.mocked(IndexMaintenanceService).mock.results[0]?.value as { listJobs: ReturnType<typeof vi.fn> };
    expect(instance.listJobs).toHaveBeenCalledWith('ws-1', 10);
  });
});

describe('POST /admin/index/maintenance/:jobType/trigger', () => {
  it('returns 400 for invalid job type', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/maintenance/unknown/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('triggers deduplicate', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/maintenance/deduplicate/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { jobType: string } };
    expect(body.data.jobType).toBe('deduplicate');
  });

  it('triggers prune_stale', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/maintenance/prune_stale/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', options: { maxAgeDays: 30 } }),
    });
    expect(res.status).toBe(200);
  });

  it('triggers rebalance', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/maintenance/rebalance/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(200);
  });

  it('triggers integrity_check', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/maintenance/integrity_check/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for missing workspaceId', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/maintenance/deduplicate/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/index/health', () => {
  it('returns 400 without workspaceId', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/health');
    expect(res.status).toBe(400);
  });

  it('returns health report', async () => {
    const app = buildApp();
    const res = await app.request('/admin/index/health?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { healthScore: number; totalEntities: number } };
    expect(typeof body.data.healthScore).toBe('number');
    expect(typeof body.data.totalEntities).toBe('number');
  });
});
