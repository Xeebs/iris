import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/data-lineage', () => ({
  DataLineageService: vi.fn().mockImplementation(() => mockInstance),
}));

import { createLineageRoutes } from '../routes/lineage.js';
import { DataLineageService } from '@iris/semantic-core/data-lineage';

const mockInstance = {
  listEntityLineage: vi.fn(),
  getLineage: vi.fn(),
  recordOrigin: vi.fn(),
  computeImpact: vi.fn(),
};

function makeApp() {
  const sql = vi.fn() as unknown as Parameters<typeof createLineageRoutes>[0];
  const app = new Hono();
  app.route('/lineage', createLineageRoutes(sql));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const sampleRecord = {
  entityId: 'deal:1',
  workspaceId: 'ws-1',
  sourceConnectorId: 'hubspot',
  transformations: [{ type: 'embedding', timestamp: '2026-06-08T00:00:00Z' }],
  lastModifiedBy: 'system',
  lastModifiedAt: new Date('2026-06-08T00:00:00Z'),
};

describe('GET /lineage', () => {
  it('returns 401 without workspace', async () => {
    const app = makeApp();
    const res = await app.request('/lineage');
    expect(res.status).toBe(401);
  });

  it('returns paginated lineage records', async () => {
    mockInstance.listEntityLineage.mockResolvedValue([sampleRecord]);
    const app = makeApp();
    const res = await app.request('/lineage', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
    expect(json.data).toHaveLength(1);
    expect(json.meta.hasMore).toBe(false);
  });

  it('returns 400 for invalid limit param', async () => {
    const app = makeApp();
    const res = await app.request('/lineage?limit=99999', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(400);
  });
});

describe('GET /lineage/:entityId', () => {
  it('returns 404 when no lineage exists', async () => {
    mockInstance.getLineage.mockResolvedValue(null);
    const app = makeApp();
    const res = await app.request('/lineage/deal:1', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(404);
  });

  it('returns lineage record', async () => {
    mockInstance.getLineage.mockResolvedValue(sampleRecord);
    const app = makeApp();
    const res = await app.request('/lineage/deal:1', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: typeof sampleRecord };
    expect(json.data.entityId).toBe('deal:1');
    expect(json.data.transformations).toHaveLength(1);
  });

  it('returns 500 on service error', async () => {
    mockInstance.getLineage.mockRejectedValue(new Error('DB fail'));
    const app = makeApp();
    const res = await app.request('/lineage/deal:1', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(500);
  });
});

describe('POST /lineage/:entityId/impact-analysis', () => {
  it('returns impact analysis result', async () => {
    const { ok } = await import('neverthrow');
    const impact = { entityId: 'deal:1', affectedEntityIds: ['e2'], depth: 3, affectedCount: 1 };
    mockInstance.computeImpact.mockResolvedValue(ok(impact));
    const app = makeApp();
    const res = await app.request('/lineage/deal:1/impact-analysis', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: typeof impact };
    expect(json.data.entityId).toBe('deal:1');
    expect(json.data.affectedCount).toBe(1);
  });

  it('returns 500 when service returns err', async () => {
    const { err } = await import('neverthrow');
    mockInstance.computeImpact.mockResolvedValue(err(new Error('graph fail')));
    const app = makeApp();
    const res = await app.request('/lineage/deal:1/impact-analysis', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(500);
  });

  it('returns 401 without workspace', async () => {
    const app = makeApp();
    const res = await app.request('/lineage/deal:1/impact-analysis', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
