/**
 * Integration tests for SyncOptimizer.
 * Requires a running Postgres instance with the sync_metrics table.
 * Run with: pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { SyncOptimizer } from '../sync-optimizer.js';

const connectionString = process.env['DATABASE_URL'] ?? 'postgresql://iris:iris@localhost:5432/iris_test';

describe.skip('SyncOptimizer integration', () => {
  let sql: ReturnType<typeof postgres>;
  let optimizer: SyncOptimizer;

  beforeAll(async () => {
    sql = postgres(connectionString);
    optimizer = new SyncOptimizer(
      sql as unknown as Parameters<typeof SyncOptimizer>[0],
    );
  });

  afterAll(async () => {
    await sql`DELETE FROM sync_metrics WHERE connector_id = 'integration-test-connector'`;
    await sql.end();
  });

  it('logs 1000+ entity sync and verifies metrics stored', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        optimizer.logSyncMetric({
          connector_id: 'integration-test-connector',
          sync_id: `sync-${i}`,
          workspace_id: 'ws-integration',
          batch_size: 100 + i * 10,
          entity_count: 95 + i * 8,
          token_count: (95 + i * 8) * 50,
          duration_ms: 2000 + i * 200,
          api_calls: 5 + i,
          rate_limited: i % 5 === 0,
          error_count: 0,
        }),
      ),
    );
    expect(results.every(r => r.isOk())).toBe(true);

    const statsResult = await optimizer.analyzeHistoricalSyncMetrics('integration-test-connector');
    expect(statsResult.isOk()).toBe(true);
    const stats = statsResult._unsafeUnwrap();
    expect(stats.totalSyncs).toBeGreaterThanOrEqual(10);
    expect(stats.avgEntityThroughput).toBeGreaterThan(0);
  });

  it('runs optimizer and confirms batch size recommendation', async () => {
    const result = await optimizer.recommendOptimalBatchSize('integration-test-connector', 300_000);
    expect(result.isOk()).toBe(true);
    const rec = result._unsafeUnwrap();
    expect(rec.recommendedBatchSize).toBeGreaterThanOrEqual(10);
    expect(rec.recommendedBatchSize).toBeLessThanOrEqual(1000);
  });
});
