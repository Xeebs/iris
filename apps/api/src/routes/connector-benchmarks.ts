import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { ConnectorBenchmarker } from '@iris/semantic-core/connector-benchmarker';
import type { BenchmarkBaseline } from '@iris/semantic-core/connector-benchmarker';

const RunBenchmarkSchema = z.object({
  entityType: z.string().min(1),
  dataSize: z.union([z.literal(1000), z.literal(10000), z.literal(100000)]).default(1000),
  timeoutMs: z.number().int().positive().max(300_000).default(60_000),
});

const CompareSchema = z.object({
  connectorIds: z.array(z.string()).min(2).max(10),
  entityType: z.string().min(1),
  dataSize: z.union([z.literal(1000), z.literal(10000), z.literal(100000)]).default(1000),
});

const MatrixSchema = z.object({
  connectorIds: z.array(z.string()).min(1).max(20),
  entityTypes: z.array(z.string()).min(1).max(20),
});

type BaselineRow = {
  baseline_id: string;
  connector_id: string;
  entity_type: string;
  baseline_throughput: number;
  baseline_memory_mb: number;
  measured_at: Date;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for connector benchmarks
 */
export function createConnectorBenchmarksRoutes(sql: Sql) {
  const app = new Hono();
  const benchmarker = new ConnectorBenchmarker(sql as unknown as ConstructorParameters<typeof ConnectorBenchmarker>[0]);

  // POST /connectors/:id/benchmark — run benchmark (uses synthetic data since real connectors aren't wired)
  app.post('/:id/benchmark', zValidator('json', RunBenchmarkSchema), async (c) => {
    const connectorId = c.req.param('id');
    const { entityType, dataSize, timeoutMs } = c.req.valid('json');

    async function* syntheticSync() {
      for (let i = 0; i < dataSize; i++) {
        yield { id: `${connectorId}:${entityType}:${i}`, type: entityType, label: `Entity ${i}`, attributes: { index: i } };
      }
    }

    try {
      const metrics = await benchmarker.executeBenchmark(connectorId, entityType, syntheticSync, {
        dataSize,
        timeoutMs,
      });
      return c.json({ data: metrics }, 200);
    } catch {
      return c.json({ error: { code: 'BENCHMARK_FAILED', message: 'Benchmark execution failed' } }, 500);
    }
  });

  // GET /connectors/:id/benchmark-results — historical results
  app.get('/:id/benchmark-results', async (c) => {
    const connectorId = c.req.param('id');
    const entityType = c.req.query('entityType');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);

    try {
      const results = await benchmarker.getResults(connectorId, entityType, limit);
      return c.json({ data: results });
    } catch {
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch results' } }, 500);
    }
  });

  // POST /connectors/compare — multi-connector comparison
  app.post('/compare', zValidator('json', CompareSchema), async (c) => {
    const { connectorIds, entityType, dataSize } = c.req.valid('json');

    try {
      const metrics = await Promise.all(
        connectorIds.map(async (connectorId) => {
          async function* syntheticSync() {
            for (let i = 0; i < Math.min(dataSize, 1000); i++) {
              yield { id: `${connectorId}:${entityType}:${i}`, type: entityType, label: `Entity ${i}`, attributes: { index: i } };
            }
          }
          return benchmarker.executeBenchmark(connectorId, entityType, syntheticSync, { dataSize: Math.min(dataSize, 1000) as 1000 });
        })
      );

      const comparison = benchmarker.compareConnectors(metrics);
      return c.json({ data: comparison });
    } catch {
      return c.json({ error: { code: 'COMPARE_FAILED', message: 'Comparison failed' } }, 500);
    }
  });

  // POST /connectors/benchmark-matrix — matrix across all connectors × entity types
  app.post('/benchmark-matrix', zValidator('json', MatrixSchema), async (c) => {
    const { connectorIds, entityTypes } = c.req.valid('json');

    try {
      const matrix = await benchmarker.getBenchmarkMatrix(connectorIds, entityTypes);
      return c.json({ data: matrix });
    } catch {
      return c.json({ error: { code: 'MATRIX_FAILED', message: 'Matrix generation failed' } }, 500);
    }
  });

  // GET /connectors/:id/regression — check for regression vs baseline
  app.get('/:id/regression', async (c) => {
    const connectorId = c.req.param('id');
    const entityType = c.req.query('entityType') ?? 'contact';

    try {
      const [recent, baselines] = await Promise.all([
        benchmarker.getResults(connectorId, entityType, 1),
        sql`
          SELECT baseline_id, connector_id, entity_type, baseline_throughput, baseline_memory_mb, measured_at
          FROM benchmark_baselines
          WHERE connector_id = ${connectorId} AND entity_type = ${entityType}
        ` as Promise<BaselineRow[]>,
      ]);

      if (recent.length === 0 || baselines.length === 0) {
        return c.json({ data: { connectorId, entityType, hasBaseline: baselines.length > 0, hasRecentRun: recent.length > 0, report: null } });
      }

      const baseline: BenchmarkBaseline = {
        connectorId: baselines[0]!.connector_id,
        entityType: baselines[0]!.entity_type,
        baselineThroughput: baselines[0]!.baseline_throughput,
        baselineMemoryMb: baselines[0]!.baseline_memory_mb,
        measuredAt: baselines[0]!.measured_at,
      };

      const report = benchmarker.detectPerformanceRegression(connectorId, entityType, recent[0]!, baseline);
      return c.json({ data: { connectorId, entityType, hasBaseline: true, hasRecentRun: true, report } });
    } catch {
      return c.json({ error: { code: 'REGRESSION_CHECK_FAILED', message: 'Failed to check regression' } }, 500);
    }
  });

  return app;
}
