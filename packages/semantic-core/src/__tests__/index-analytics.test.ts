import { describe, it, expect, vi } from 'vitest';
import { IndexAnalyticsService } from '../index-analytics.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

type Responses = Array<unknown[]>;

function makeSql(...responses: Responses) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? [];
    return Promise.resolve(r);
  });
  return fn as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>;
}

// ─── getCompositionMetrics ────────────────────────────────────────────────────

describe('IndexAnalyticsService.getCompositionMetrics', () => {
  it('returns composition with entity type breakdown', async () => {
    const typeRows = [
      { entity_type: 'deal', count: '500' },
      { entity_type: 'contact', count: '300' },
    ];
    const connectorRows = [
      { source_connector_id: 'hubspot', count: '700' },
      { source_connector_id: 'salesforce', count: '100' },
    ];
    const svc = new IndexAnalyticsService(makeSql(typeRows, connectorRows));
    const result = await svc.getCompositionMetrics('ws-1');
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.totalEntities).toBe(800);
    expect(data.byEntityType).toHaveLength(2);
    expect(data.byEntityType[0]?.entityType).toBe('deal');
    expect(data.byEntityType[0]?.storageBytesEstimate).toBe(500 * 6144);
  });

  it('computes connector contribution percentages', async () => {
    const typeRows = [{ entity_type: 'deal', count: '100' }];
    const connectorRows = [{ source_connector_id: 'hubspot', count: '100' }];
    const svc = new IndexAnalyticsService(makeSql(typeRows, connectorRows));
    const result = await svc.getCompositionMetrics('ws-1');
    const contrib = result._unsafeUnwrap().byConnector[0]!;
    expect(contrib.pctOfTotal).toBe(100);
  });

  it('handles empty workspace gracefully', async () => {
    const svc = new IndexAnalyticsService(makeSql([], []));
    const result = await svc.getCompositionMetrics('ws-empty');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalEntities).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('DB fail'));
    const svc = new IndexAnalyticsService(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.getCompositionMetrics('ws-1');
    expect(result.isErr()).toBe(true);
  });
});

// ─── getFreshnessMetrics ──────────────────────────────────────────────────────

describe('IndexAnalyticsService.getFreshnessMetrics', () => {
  it('returns freshness percentages', async () => {
    const svc = new IndexAnalyticsService(makeSql(
      [{ count: '1000' }],
      [{ count: '200' }],
      [{ count: '600' }],
      [{ entity_type: 'deal', avg_age_days: '14.5' }],
      [{ source_connector_id: 'hubspot', last_sync: '2026-06-01T00:00:00Z' }],
    ));
    const result = await svc.getFreshnessMetrics('ws-1');
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.pctUpdatedLast7Days).toBe(20);
    expect(data.pctUpdatedLast30Days).toBe(60);
    expect(data.avgAgeByType['deal']).toBe(14.5);
    expect(data.lastSyncByConnector['hubspot']).toBe('2026-06-01T00:00:00Z');
  });

  it('returns 0% when workspace is empty', async () => {
    const svc = new IndexAnalyticsService(makeSql(
      [{ count: '0' }], [{ count: '0' }], [{ count: '0' }], [], [],
    ));
    const result = await svc.getFreshnessMetrics('ws-1');
    expect(result._unsafeUnwrap().pctUpdatedLast7Days).toBe(0);
    expect(result._unsafeUnwrap().pctUpdatedLast30Days).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    const svc = new IndexAnalyticsService(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.getFreshnessMetrics('ws-1');
    expect(result.isErr()).toBe(true);
  });
});

// ─── getQualityMetrics ────────────────────────────────────────────────────────

describe('IndexAnalyticsService.getQualityMetrics', () => {
  it('returns quality metrics', async () => {
    const svc = new IndexAnalyticsService(makeSql(
      [{ count: '1000' }],
      [{ with_relationships: '400', avg_density: '2.5' }],
      [{ pct_embedded: '95.0' }],
      [{ total_merged: '30' }],
    ));
    const result = await svc.getQualityMetrics('ws-1');
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.pctWithRelationships).toBe(40);
    expect(data.avgRelationshipDensity).toBe(2.5);
    expect(data.embeddingCoveragePct).toBe(95);
    expect(data.dedupRatioLast30Days).toBe(3);
  });

  it('handles empty workspace with zeros', async () => {
    const svc = new IndexAnalyticsService(makeSql(
      [{ count: '0' }],
      [{ with_relationships: '0', avg_density: '0' }],
      [{ pct_embedded: '0' }],
      [{ total_merged: '0' }],
    ));
    const result = await svc.getQualityMetrics('ws-1');
    const data = result._unsafeUnwrap();
    expect(data.pctWithRelationships).toBe(0);
    expect(data.embeddingCoveragePct).toBe(0);
  });
});

// ─── getOptimizationOpportunities ────────────────────────────────────────────

describe('IndexAnalyticsService.getOptimizationOpportunities', () => {
  it('returns dedup opportunity for high-count entity types', async () => {
    const svc = new IndexAnalyticsService(makeSql(
      [{ entity_type: 'deal', count: '5000' }],
      [],
      [{ count: '0' }],
    ));
    const result = await svc.getOptimizationOpportunities('ws-1');
    expect(result.isOk()).toBe(true);
    const opps = result._unsafeUnwrap();
    const dedup = opps.find((o) => o.type === 'dedup');
    expect(dedup).toBeDefined();
    expect(dedup?.priority).toBe('high');
  });

  it('returns archive opportunity for stale connectors', async () => {
    const svc = new IndexAnalyticsService(makeSql(
      [],
      [{ source_connector_id: 'old-connector', last_sync: null, count: '2000' }],
      [{ count: '0' }],
    ));
    const result = await svc.getOptimizationOpportunities('ws-1');
    const opps = result._unsafeUnwrap();
    const archive = opps.find((o) => o.type === 'archive_connector');
    expect(archive).toBeDefined();
  });

  it('returns missing embeddings opportunity', async () => {
    const svc = new IndexAnalyticsService(makeSql(
      [],
      [],
      [{ count: '600' }],
    ));
    const result = await svc.getOptimizationOpportunities('ws-1');
    const opps = result._unsafeUnwrap();
    const reindex = opps.find((o) => o.type === 'index_rebalance');
    expect(reindex).toBeDefined();
    expect(reindex?.priority).toBe('high');
  });

  it('sorts opportunities by priority', async () => {
    const svc = new IndexAnalyticsService(makeSql(
      [{ entity_type: 'deal', count: '5000' }],
      [{ source_connector_id: 'old', last_sync: null, count: '1000' }],
      [{ count: '600' }],
    ));
    const result = await svc.getOptimizationOpportunities('ws-1');
    const opps = result._unsafeUnwrap();
    const priorities = opps.map((o) => o.priority);
    expect(priorities[0]).toBe('high');
  });

  it('returns empty when no issues found', async () => {
    const svc = new IndexAnalyticsService(makeSql([], [], [{ count: '0' }]));
    const result = await svc.getOptimizationOpportunities('ws-1');
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });
});

// ─── saveSnapshot / getSnapshots ─────────────────────────────────────────────

describe('IndexAnalyticsService.saveSnapshot', () => {
  it('returns ok on success', async () => {
    const svc = new IndexAnalyticsService(makeSql([]));
    const result = await svc.saveSnapshot('ws-1', {
      workspaceId: 'ws-1',
      totalEntities: 100,
      byEntityType: [],
      byConnector: [],
      snapshotAt: new Date().toISOString(),
    });
    expect(result.isOk()).toBe(true);
  });
});

describe('IndexAnalyticsService.getSnapshots', () => {
  it('returns trend data', async () => {
    const svc = new IndexAnalyticsService(makeSql([
      { date: '2026-06-01', total: '900' },
      { date: '2026-06-08', total: '1000' },
    ]));
    const result = await svc.getSnapshots('ws-1', 30);
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data).toHaveLength(2);
    expect(data[0]?.totalEntities).toBe(900);
  });
});
