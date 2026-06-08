import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { IndexAnalyticsService } from '../index-analytics.js';

/**
 * Integration tests for IndexAnalyticsService.
 * Requires Postgres running via docker-compose up -d.
 * Run with: pnpm test:integration
 */

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const connectionString = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(connectionString);
});

afterAll(async () => {
  await sql.end();
});

describe('IndexAnalyticsService integration', () => {
  it('returns empty metrics for workspace with no data', async () => {
    const svc = new IndexAnalyticsService(sql);
    const comp = await svc.getCompositionMetrics('analytics-int-test-ws');
    expect(comp.isOk()).toBe(true);
    expect(comp._unsafeUnwrap().totalEntities).toBe(0);

    const quality = await svc.getQualityMetrics('analytics-int-test-ws');
    expect(quality.isOk()).toBe(true);
    expect(quality._unsafeUnwrap().embeddingCoveragePct).toBe(0);
  });
});
