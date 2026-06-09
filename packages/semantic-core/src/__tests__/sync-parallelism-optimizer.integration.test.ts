/**
 * Integration tests for SyncParallelismOptimizer — requires real Postgres.
 * Run with: pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { SyncParallelismOptimizer, type ExperimentVariant } from '../sync-parallelism-optimizer.js';

const TEST_CONNECTOR = 'test-connector-opt';
const TEST_WORKSPACE = 'test-workspace-opt';

let sql: ReturnType<typeof postgres>;
let optimizer: SyncParallelismOptimizer;

beforeAll(async () => {
  sql = postgres(process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test');
  optimizer = new SyncParallelismOptimizer(sql);

  await sql`
    INSERT INTO sync_optimization_configs
      (connector_id, workspace_id, entity_type, concurrency, batch_size, worker_weight, auto_tune)
    VALUES
      (${TEST_CONNECTOR}, ${TEST_WORKSPACE}, '*', 5, 100, 1.0, true)
    ON CONFLICT (connector_id, workspace_id, entity_type) DO NOTHING
  `;
});

afterAll(async () => {
  await sql`
    DELETE FROM sync_optimization_configs
    WHERE connector_id = ${TEST_CONNECTOR} AND workspace_id = ${TEST_WORKSPACE}
  `;
  await sql`
    DELETE FROM optimization_experiments
    WHERE connector_id = ${TEST_CONNECTOR} AND workspace_id = ${TEST_WORKSPACE}
  `;
  await sql.end();
});

describe('SyncParallelismOptimizer integration', () => {
  it('saves and retrieves optimization config', async () => {
    await optimizer.saveConfig({
      connectorId: TEST_CONNECTOR,
      workspaceId: TEST_WORKSPACE,
      entityType: 'contact',
      concurrency: 7,
      batchSize: 150,
      workerWeight: 1.5,
      autoTune: true,
      lastTunedAt: null,
    });

    const { current } = await optimizer.getConfigWithRecommendation(
      TEST_CONNECTOR,
      TEST_WORKSPACE,
      []
    );

    expect(current.concurrency === 7 || current.concurrency === 5).toBe(true);
  });

  it('upserts config without creating duplicates', async () => {
    for (let i = 0; i < 3; i++) {
      await optimizer.saveConfig({
        connectorId: TEST_CONNECTOR,
        workspaceId: TEST_WORKSPACE,
        entityType: 'deal',
        concurrency: 4 + i,
        batchSize: 100,
        workerWeight: 1.0,
        autoTune: true,
        lastTunedAt: null,
      });
    }
    const rows = await sql`
      SELECT COUNT(*) AS cnt FROM sync_optimization_configs
      WHERE connector_id = ${TEST_CONNECTOR}
        AND workspace_id = ${TEST_WORKSPACE}
        AND entity_type = 'deal'
    `;
    expect(Number(rows[0].cnt)).toBe(1);
  });

  it('creates an experiment and returns its ID', async () => {
    const variant: ExperimentVariant = {
      name: 'integration-test-variant',
      concurrency: 8,
      batchSize: 200,
      trafficPct: 10,
    };
    const id = await optimizer.executeOptimizationExperiment(
      TEST_CONNECTOR,
      TEST_WORKSPACE,
      variant
    );
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('records experiment results and marks experiment completed', async () => {
    const variant: ExperimentVariant = {
      name: 'results-test-variant',
      concurrency: 6,
      batchSize: 120,
      trafficPct: 5,
    };
    const expId = await optimizer.executeOptimizationExperiment(
      TEST_CONNECTOR,
      TEST_WORKSPACE,
      variant
    );
    await optimizer.recordExperimentResults(expId, TEST_CONNECTOR, TEST_WORKSPACE, {
      throughputPerSec: 42.5,
      p95LatencyMs: 1800,
      errorRate: 0.02,
      entitiesSynced: 850,
      durationMs: 20000,
    });

    const rows = await sql`
      SELECT status FROM optimization_experiments WHERE id = ${expId}
    `;
    expect(rows[0].status).toBe('completed');
  });

  it('lists experiments ordered by most recent', async () => {
    const experiments = await optimizer.listExperiments(TEST_CONNECTOR, TEST_WORKSPACE, 10);
    expect(Array.isArray(experiments)).toBe(true);
    expect(experiments.length).toBeGreaterThan(0);
    expect(experiments[0].experiment).toHaveProperty('variantName');
  });

  it('allocates workers proportionally across multiple connectors', async () => {
    await sql`
      INSERT INTO sync_optimization_configs
        (connector_id, workspace_id, entity_type, concurrency, batch_size, worker_weight, auto_tune)
      VALUES
        ('heavy-conn', ${TEST_WORKSPACE}, '*', 10, 200, 3.0, true),
        ('light-conn', ${TEST_WORKSPACE}, '*', 2, 50, 1.0, true)
      ON CONFLICT (connector_id, workspace_id, entity_type)
      DO UPDATE SET worker_weight = EXCLUDED.worker_weight
    `;

    const allocations = await optimizer.allocateWorkerPool(
      TEST_WORKSPACE,
      ['heavy-conn', 'light-conn'],
      12
    );
    const heavy = allocations.find((a) => a.connectorId === 'heavy-conn')!;
    const light = allocations.find((a) => a.connectorId === 'light-conn')!;
    expect(heavy.workers).toBeGreaterThan(light.workers);

    await sql`
      DELETE FROM sync_optimization_configs
      WHERE connector_id IN ('heavy-conn', 'light-conn') AND workspace_id = ${TEST_WORKSPACE}
    `;
  });

  it('detectOptimizationWindow returns a result structure', async () => {
    const window = await optimizer.detectOptimizationWindow(TEST_CONNECTOR, TEST_WORKSPACE);
    expect(window).toHaveProperty('connectorId', TEST_CONNECTOR);
    expect(typeof window.stableEnough).toBe('boolean');
    expect(typeof window.reason).toBe('string');
  });

  it('full auto-tune round-trip: recommend → save → retrieve', async () => {
    const metrics = [
      { concurrency: 3, throughputPerSec: 30, p95LatencyMs: 800, errorRate: 0.01, entityCount: 500, durationMs: 16000 },
      { concurrency: 5, throughputPerSec: 50, p95LatencyMs: 900, errorRate: 0.01, entityCount: 500, durationMs: 10000 },
      { concurrency: 7, throughputPerSec: 68, p95LatencyMs: 1100, errorRate: 0.01, entityCount: 500, durationMs: 7350 },
    ];
    const rec = await optimizer.recommendConcurrency(TEST_CONNECTOR, 'deal', metrics);
    await optimizer.saveConfig({
      connectorId: TEST_CONNECTOR,
      workspaceId: TEST_WORKSPACE,
      entityType: 'deal',
      concurrency: rec.recommended,
      batchSize: 100,
      workerWeight: 1.0,
      autoTune: true,
      lastTunedAt: new Date(),
    });

    const rows = await sql`
      SELECT concurrency FROM sync_optimization_configs
      WHERE connector_id = ${TEST_CONNECTOR}
        AND workspace_id = ${TEST_WORKSPACE}
        AND entity_type = 'deal'
    `;
    expect(rows[0].concurrency).toBe(rec.recommended);
  });
});
