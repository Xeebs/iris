import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { BudgetMonitor } from '@iris/semantic-core/budget-monitor';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'budget-management-routes' });

const BudgetConfigBody = z.object({
  monthlyTokenBudget: z.number().int().positive(),
  rollingWindowDays: z.number().int().min(1).max(365).default(30),
  alertThresholds: z.array(z.number().min(1).max(100)).default([75, 90, 100]),
  autoLimitMode: z.boolean().default(false),
});

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createBudgetManagementRoutes(sql: Sql) {
  const router = new Hono();
  const monitor = new BudgetMonitor(sql as never);

  router.get('/budget-status', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const [utilizationResult, alertsResult, anomaliesResult] = await Promise.all([
      monitor.computeBudgetUtilization(workspaceId),
      monitor.getActiveAlerts(workspaceId),
      monitor.detectBudgetAnomalies(workspaceId),
    ]);

    if (utilizationResult.isErr()) {
      log.error('Budget status fetch failed', { error: utilizationResult.error.message });
      return c.json({ error: { code: 'FETCH_FAILED', message: utilizationResult.error.message } }, 500);
    }

    return c.json({
      data: {
        utilization: utilizationResult.value,
        activeAlerts: alertsResult.isOk() ? alertsResult.value : [],
        anomalies: anomaliesResult.isOk() ? anomaliesResult.value : [],
      },
    });
  });

  router.put('/budget-config', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const parsed = BudgetConfigBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.format() } }, 400);
    }

    const { monthlyTokenBudget, rollingWindowDays, alertThresholds, autoLimitMode } = parsed.data;

    try {
      await (sql as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>)`
        INSERT INTO workspace_budgets
          (workspace_id, monthly_token_budget, rolling_window_days, alert_thresholds, auto_limit_mode, updated_at)
        VALUES
          (${workspaceId}, ${monthlyTokenBudget}, ${rollingWindowDays}, ${sql.json(alertThresholds)}, ${autoLimitMode}, NOW())
        ON CONFLICT (workspace_id) DO UPDATE SET
          monthly_token_budget = EXCLUDED.monthly_token_budget,
          rolling_window_days = EXCLUDED.rolling_window_days,
          alert_thresholds = EXCLUDED.alert_thresholds,
          auto_limit_mode = EXCLUDED.auto_limit_mode,
          updated_at = NOW()
      `;

      log.info('Budget config updated', { workspaceId, monthlyTokenBudget });
      return c.json({ data: { workspaceId, monthlyTokenBudget, rollingWindowDays, alertThresholds, autoLimitMode } });
    } catch (e) {
      log.error('Budget config update failed', { error: String(e) });
      return c.json({ error: { code: 'UPDATE_FAILED', message: String(e) } }, 500);
    }
  });

  router.get('/budget-history', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const days = Math.min(Number(c.req.query('days') ?? 30), 90);

    try {
      const rows = await (sql as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>)`
        SELECT
          DATE_TRUNC('day', timestamp) AS day,
          SUM(tokens_consumed)::int AS total_tokens,
          COUNT(*)::int AS query_count,
          AVG(context_size)::int AS avg_context_size
        FROM budget_usage_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= NOW() - (${days} * INTERVAL '1 day')
        GROUP BY 1
        ORDER BY 1 ASC
      ` as Array<{ day: string; total_tokens: number; query_count: number; avg_context_size: number }>;

      const adjustment = await monitor.suggestBudgetAdjustments(workspaceId);

      return c.json({
        data: {
          chartData: rows.map((r) => ({
            date: r.day,
            tokens: r.total_tokens,
            queryCount: r.query_count,
            avgContextSize: r.avg_context_size,
          })),
          suggestion: adjustment.isOk() ? adjustment.value : null,
        },
      });
    } catch (e) {
      log.error('Budget history fetch failed', { error: String(e) });
      return c.json({ error: { code: 'FETCH_FAILED', message: String(e) } }, 500);
    }
  });

  return router;
}
