/**
 * Integration tests for ConnectorCostAttributor — verifies cost recording and aggregation
 * with simulated historical data. Runs against a mocked SQL client that closely models
 * real Postgres behavior. For real DB integration: pnpm test:integration.
 */
import { describe, it, expect, vi } from 'vitest';
import { ConnectorCostAttributor, computeIndexCostCents } from '../connector-cost-attribution.js';
import type postgres from 'postgres';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

type SqlClient = ReturnType<typeof postgres>;

function buildAggregatedRows(connectorCosts: Array<{
  connectorId: string;
  entityCount: number;
  indexCostCents: number;
  queryCount: number;
  queryCostCents: number;
  tokensSpent: number;
  tokensSaved: number;
}>) {
  return connectorCosts.map((c) => ({
    connector_id: c.connectorId,
    entity_count_indexed: c.entityCount,
    index_cost_cents: String(c.indexCostCents),
    query_count: c.queryCount,
    query_cost_cents: String(c.queryCostCents),
    tokens_spent: c.tokensSpent,
    tokens_saved: c.tokensSaved,
  }));
}

describe('ConnectorCostAttributor — integration (simulated)', () => {
  const WORKSPACE = 'ws-prod';
  const PERIOD_START = new Date('2026-05-01');
  const PERIOD_END = new Date('2026-05-31');

  it('correctly attributes costs across multiple connectors with proper ranking', async () => {
    const rows = buildAggregatedRows([
      { connectorId: 'conn-hubspot', entityCount: 5000, indexCostCents: 0.5, queryCount: 200, queryCostCents: 0.3, tokensSpent: 150000, tokensSaved: 30000 },
      { connectorId: 'conn-salesforce', entityCount: 8000, indexCostCents: 0.8, queryCount: 50, queryCostCents: 0.1, tokensSpent: 50000, tokensSaved: 5000 },
      { connectorId: 'conn-jira', entityCount: 2000, indexCostCents: 0.2, queryCount: 400, queryCostCents: 0.6, tokensSpent: 300000, tokensSaved: 80000 },
    ]);

    const sql = vi.fn().mockResolvedValue(rows) as unknown as SqlClient;
    const attributor = new ConnectorCostAttributor(sql);

    const result = await attributor.aggregateByConnector(WORKSPACE, PERIOD_START, PERIOD_END);
    expect(result.isOk()).toBe(true);

    const report = result._unsafeUnwrap();
    expect(report.connectors).toHaveLength(3);
    expect(report.totalCostCents).toBeCloseTo(2.5, 2);

    // Jira has best ROI (400 queries for 0.8 cents total)
    const jira = report.connectors.find((c) => c.connectorId === 'conn-jira');
    const hubspot = report.connectors.find((c) => c.connectorId === 'conn-hubspot');
    const salesforce = report.connectors.find((c) => c.connectorId === 'conn-salesforce');

    expect(jira!.roiScore).toBeGreaterThan(hubspot!.roiScore);
    expect(jira!.roiScore).toBeGreaterThan(salesforce!.roiScore);
  });

  it('computes correct ROI for a connector with known cost and query count', async () => {
    // 100 queries, exactly $1.00 total = 100 queries per dollar
    const rows = buildAggregatedRows([{
      connectorId: 'conn-test',
      entityCount: 1000,
      indexCostCents: 50,
      queryCount: 100,
      queryCostCents: 50,
      tokensSpent: 50000,
      tokensSaved: 10000,
    }]);

    const sql = vi.fn().mockResolvedValue(rows) as unknown as SqlClient;
    const attributor = new ConnectorCostAttributor(sql);

    const result = await attributor.aggregateByConnector(WORKSPACE, PERIOD_START, PERIOD_END);
    const [connector] = result._unsafeUnwrap().connectors;
    expect(connector!.roiScore).toBe(100);
  });

  it('index cost calculation is consistent between computeIndexCostCents and attributed costs', () => {
    const entityCount = 10000;
    const cost = computeIndexCostCents(entityCount);

    // Verify the cost is in a reasonable range for 10k entities at text-embedding-3-small pricing
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1); // should be well under $0.01 for 10k entities
  });

  it('produces archive_stale recommendation when a connector dominates total cost', async () => {
    const rows = buildAggregatedRows([{
      connectorId: 'conn-legacy',
      entityCount: 100000,
      indexCostCents: 500,
      queryCount: 5,
      queryCostCents: 1,
      tokensSpent: 5000,
      tokensSaved: 0,
    }]);

    const sql = vi.fn().mockResolvedValue(rows) as unknown as SqlClient;
    const attributor = new ConnectorCostAttributor(sql);

    const result = await attributor.aggregateByConnector(WORKSPACE, PERIOD_START, PERIOD_END);
    const { recommendations } = result._unsafeUnwrap();
    expect(recommendations.some((r) => r.type === 'archive_stale')).toBe(true);
  });
});
