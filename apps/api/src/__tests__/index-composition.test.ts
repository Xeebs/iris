import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/index-analytics', () => {
  const mockComp = vi.fn();
  const mockFresh = vi.fn();
  const mockQuality = vi.fn();
  const mockOpps = vi.fn();
  const mockSnapshots = vi.fn();
  return {
    IndexAnalyticsService: vi.fn().mockImplementation(() => ({
      getCompositionMetrics: mockComp,
      getFreshnessMetrics: mockFresh,
      getQualityMetrics: mockQuality,
      getOptimizationOpportunities: mockOpps,
      getSnapshots: mockSnapshots,
    })),
    __mocks: { mockComp, mockFresh, mockQuality, mockOpps, mockSnapshots },
  };
});

import { createIndexCompositionRoutes } from '../routes/index-composition.js';
import { IndexAnalyticsService } from '@iris/semantic-core/index-analytics';

function makeApp() {
  const sql = vi.fn() as unknown as Parameters<typeof createIndexCompositionRoutes>[0];
  const app = new Hono();
  app.route('/analytics/index', createIndexCompositionRoutes(sql));
  return app;
}

const mockComp = {
  workspaceId: 'ws-1',
  totalEntities: 1000,
  byEntityType: [{ entityType: 'deal', count: 1000, storageBytesEstimate: 6144000 }],
  byConnector: [{ connectorId: 'hubspot', entityCount: 1000, pctOfTotal: 100 }],
  snapshotAt: '2026-06-08T00:00:00Z',
};

const mockFresh = {
  workspaceId: 'ws-1',
  pctUpdatedLast7Days: 40,
  pctUpdatedLast30Days: 80,
  avgAgeByType: { deal: 5 },
  lastSyncByConnector: { hubspot: '2026-06-01T00:00:00Z' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /analytics/index', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/analytics/index');
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('MISSING_PARAM');
  });

  it('returns full report on success', async () => {
    const { ok } = await import('neverthrow');
    const inst = {
      getCompositionMetrics: vi.fn().mockResolvedValue(ok(mockComp)),
      getFreshnessMetrics: vi.fn().mockResolvedValue(ok(mockFresh)),
      getQualityMetrics: vi.fn().mockResolvedValue(ok({ workspaceId: 'ws-1', pctWithRelationships: 50, avgRelationshipDensity: 2, embeddingCoveragePct: 95, dedupRatioLast30Days: 1 })),
      getOptimizationOpportunities: vi.fn().mockResolvedValue(ok([])),
      getSnapshots: vi.fn(),
    };
    (IndexAnalyticsService as ReturnType<typeof vi.fn>).mockImplementation(() => inst);

    const app = makeApp();
    const res = await app.request('/analytics/index?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { composition: typeof mockComp } };
    expect(json.data.composition.totalEntities).toBe(1000);
  });

  it('returns 500 when composition query fails', async () => {
    const { err } = await import('neverthrow');
    const inst = {
      getCompositionMetrics: vi.fn().mockResolvedValue(err(new Error('DB fail'))),
      getFreshnessMetrics: vi.fn().mockResolvedValue(err(new Error('DB fail'))),
      getQualityMetrics: vi.fn(),
      getOptimizationOpportunities: vi.fn(),
      getSnapshots: vi.fn(),
    };
    (IndexAnalyticsService as ReturnType<typeof vi.fn>).mockImplementation(() => inst);

    const app = makeApp();
    const res = await app.request('/analytics/index?workspaceId=ws-1');
    expect(res.status).toBe(500);
  });
});

describe('GET /analytics/index/snapshots', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/analytics/index/snapshots');
    expect(res.status).toBe(400);
  });

  it('returns snapshots on success', async () => {
    const { ok } = await import('neverthrow');
    const snapshots = [{ date: '2026-06-01', totalEntities: 900 }];
    const inst = {
      getSnapshots: vi.fn().mockResolvedValue(ok(snapshots)),
      getCompositionMetrics: vi.fn(),
      getFreshnessMetrics: vi.fn(),
      getQualityMetrics: vi.fn(),
      getOptimizationOpportunities: vi.fn(),
    };
    (IndexAnalyticsService as ReturnType<typeof vi.fn>).mockImplementation(() => inst);

    const app = makeApp();
    const res = await app.request('/analytics/index/snapshots?workspaceId=ws-1&days=7');
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });
});
