import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { ComputedMetricEngine } from '@iris/semantic-core/computed-metrics';
import { logger } from '@iris/core/logger';
import type { MetricDefinition, ComputeResult, ExplainResult } from '@iris/semantic-core/computed-metrics';

const log = logger.child({ service: 'computed-metrics-routes' });

const DefineMetricSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(100),
  formula: z.string().min(1),
  description: z.string().default(''),
});

const ComputeMetricSchema = z.object({
  workspaceId: z.string().min(1),
});

type ComputedMetricRow = {
  metric_id: string;
  workspace_id: string;
  name: string;
  formula_text: string;
  formula_ast: unknown;
  description: string | null;
  last_computed_value: string | null;
  last_computed_at: Date | null;
  computation_status: string;
  computation_error: string | null;
  created_at: Date;
  updated_at: Date;
};

type ComputationLogRow = {
  log_id: string;
  metric_id: string;
  computed_value: string | null;
  entity_count_used: number;
  execution_time_ms: string;
  error_message: string | null;
  computed_at: Date;
};

const engine = new ComputedMetricEngine();

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for computed metrics endpoints
 */
export function createComputedMetricsRoutes(sql: Sql) {
  const app = new Hono();

  // POST /metrics/computed — define a new metric
  app.post('/', zValidator('json', DefineMetricSchema), async (c) => {
    const { workspaceId, name, formula, description } = c.req.valid('json');

    const result = engine.defineMetric(workspaceId, name, formula, description);
    if ('kind' in result) {
      return c.json({ error: { code: 'PARSE_ERROR', message: result.message } }, 400);
    }

    const def = result as MetricDefinition;

    try {
      await sql`
        INSERT INTO computed_metrics
          (metric_id, workspace_id, name, formula_text, formula_ast, description, computation_status)
        VALUES
          (${def.metricId}, ${workspaceId}, ${name}, ${formula},
           ${JSON.stringify(def.formulaAst)}, ${description}, 'pending')
        ON CONFLICT (metric_id) DO UPDATE SET
          formula_text = EXCLUDED.formula_text,
          formula_ast = EXCLUDED.formula_ast,
          description = EXCLUDED.description,
          updated_at = NOW()
      `;
    } catch (err) {
      log.error('Failed to persist metric definition', { error: err instanceof Error ? err.message : String(err) });
    }

    return c.json({ data: { metricId: def.metricId, name, formula, workspaceId } }, 201);
  });

  // GET /metrics/computed — list metrics for workspace
  app.get('/', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';

    try {
      const rows = await sql`
        SELECT metric_id, workspace_id, name, formula_text, description,
               last_computed_value, last_computed_at, computation_status, computation_error,
               created_at, updated_at
        FROM computed_metrics
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
      ` as ComputedMetricRow[];

      return c.json({
        data: rows.map((r) => ({
          metricId: r.metric_id,
          name: r.name,
          formulaText: r.formula_text,
          description: r.description,
          lastComputedValue: r.last_computed_value !== null ? parseFloat(r.last_computed_value) : null,
          lastComputedAt: r.last_computed_at,
          status: r.computation_status,
          error: r.computation_error,
        })),
        meta: { total: rows.length },
      });
    } catch (err) {
      log.error('Failed to list metrics', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to list metrics' } }, 500);
    }
  });

  // GET /metrics/computed/:id/value — get current computed value
  app.get('/:id/value', zValidator('query', ComputeMetricSchema), async (c) => {
    const metricId = c.req.param('id');
    const { workspaceId } = c.req.valid('query');

    try {
      const rows = await sql`
        SELECT metric_id, name, formula_text, formula_ast, last_computed_value,
               last_computed_at, computation_status
        FROM computed_metrics
        WHERE metric_id = ${metricId} AND workspace_id = ${workspaceId}
        LIMIT 1
      ` as ComputedMetricRow[];

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: `Metric not found: ${metricId}` } }, 404);
      }

      const row = rows[0]!;
      return c.json({
        data: {
          metricId: row.metric_id,
          name: row.name,
          value: row.last_computed_value !== null ? parseFloat(row.last_computed_value) : null,
          lastComputedAt: row.last_computed_at,
          status: row.computation_status,
        },
      });
    } catch (err) {
      log.error('Failed to fetch metric value', { metricId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch metric value' } }, 500);
    }
  });

  // GET /metrics/computed/:id/explain — show how metric was computed
  app.get('/:id/explain', async (c) => {
    const metricId = c.req.param('id');

    try {
      const logRows = await sql`
        SELECT log_id, metric_id, computed_value, entity_count_used, execution_time_ms,
               error_message, computed_at
        FROM metric_computation_log
        WHERE metric_id = ${metricId}
        ORDER BY computed_at DESC
        LIMIT 5
      ` as ComputationLogRow[];

      const def = engine.getMetric(metricId);
      const explanation = def
        ? { formulaText: def.formulaText, sampleEntities: [], intermediateSteps: [], finalValue: 0 }
        : null;

      return c.json({
        data: {
          metricId,
          explanation,
          recentComputations: logRows.map((r) => ({
            logId: r.log_id,
            value: r.computed_value !== null ? parseFloat(r.computed_value) : null,
            entityCount: r.entity_count_used,
            executionMs: parseFloat(r.execution_time_ms),
            error: r.error_message,
            computedAt: r.computed_at,
          })),
        },
      });
    } catch (err) {
      log.error('Failed to explain metric', { metricId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch explanation' } }, 500);
    }
  });

  return app;
}
