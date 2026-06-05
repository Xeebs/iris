/**
 * Integration tests for MetricRegistry — require real Postgres.
 * Run with: pnpm test:integration (after docker-compose up -d)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { MetricRegistry } from '../metrics.js';

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/iris_test';

describe.skipIf(!process.env['INTEGRATION'])('MetricRegistry — integration', () => {
  let sql: ReturnType<typeof postgres>;
  let registry: MetricRegistry;
  const workspaceId = `test-ws-${Date.now()}`;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL);
    await sql`
      INSERT INTO workspaces (id, name) VALUES (${workspaceId}, 'Test Workspace')
      ON CONFLICT DO NOTHING
    `;
    registry = new MetricRegistry(sql);
  });

  afterAll(async () => {
    await sql`DELETE FROM metrics WHERE workspace_id = ${workspaceId}`;
    await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    await sql.end();
  });

  it('defines, retrieves, and deletes a metric', async () => {
    const defineResult = await registry.defineMetric(
      workspaceId,
      'monthly_revenue',
      'SUM(amount)',
      'Total monthly revenue',
    );
    expect(defineResult.isOk()).toBe(true);

    const getResult = await registry.getMetric(workspaceId, 'monthly_revenue');
    expect(getResult.isOk()).toBe(true);
    expect(getResult._unsafeUnwrap()?.formula).toBe('SUM(amount)');

    const deleteResult = await registry.deleteMetric(workspaceId, 'monthly_revenue');
    expect(deleteResult.isOk()).toBe(true);
    expect(deleteResult._unsafeUnwrap()).toBe(true);

    const notFound = await registry.getMetric(workspaceId, 'monthly_revenue');
    expect(notFound._unsafeUnwrap()).toBeNull();
  });

  it('upserts on duplicate metric name', async () => {
    await registry.defineMetric(workspaceId, 'churn_rate', 'churned / total', 'Churn rate');
    const updated = await registry.defineMetric(workspaceId, 'churn_rate', 'churned / total * 100', 'Churn rate %');
    expect(updated._unsafeUnwrap()?.formula).toBe('churned / total * 100');
    await registry.deleteMetric(workspaceId, 'churn_rate');
  });

  it('lists all metrics for workspace', async () => {
    await registry.defineMetric(workspaceId, 'arr', 'MRR * 12', 'Annual Recurring Revenue');
    await registry.defineMetric(workspaceId, 'mrr', 'SUM(monthly_subscriptions)', 'Monthly Recurring Revenue');

    const listResult = await registry.listMetrics(workspaceId);
    expect(listResult.isOk()).toBe(true);
    expect(listResult._unsafeUnwrap().length).toBeGreaterThanOrEqual(2);

    await registry.deleteMetric(workspaceId, 'arr');
    await registry.deleteMetric(workspaceId, 'mrr');
  });
});
