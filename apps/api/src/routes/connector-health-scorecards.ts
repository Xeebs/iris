import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { ConnectorHealthScorer } from '@iris/semantic-core/connector-health-scorer';
import { logger } from '@iris/core/logger';

const SlaTargetSchema = z.object({
  workspaceId: z.string().min(1),
  minHealthScore: z.number().int().min(0).max(100).default(70),
  minSyncSuccessRate: z.number().min(0).max(1).default(0.95),
  maxSyncLatencySeconds: z.number().int().positive().default(300),
  uptimeTargetPct: z.number().min(0).max(100).default(99.5),
  measurementWindowDays: z.number().int().positive().max(365).default(30),
});

const ResolveAlertSchema = z.object({
  workspaceId: z.string().min(1),
});

const RecoveryActionSchema = z.object({
  workspaceId: z.string().min(1),
  actionType: z.enum(['re-auth', 'manual-sync', 'pause', 'retry']),
});

type SlaTargetRow = {
  target_id: string;
  connector_id: string;
  workspace_id: string;
  min_health_score: number;
  min_sync_success_rate: number;
  max_sync_latency_seconds: number;
  uptime_target_pct: number;
  measurement_window_days: number;
  created_at: Date;
};

type SlaBreachRow = {
  breach_id: string;
  connector_id: string;
  workspace_id: string;
  breach_type: string;
  actual_value: number;
  target_value: number;
  breach_started_at: Date;
  breach_resolved_at: Date | null;
  description: string | null;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for connector health scorecards
 */
export function createConnectorHealthScorecardsRoutes(sql: Sql) {
  const app = new Hono();
  const scorer = new ConnectorHealthScorer(sql as unknown as ConstructorParameters<typeof ConnectorHealthScorer>[0]);

  // GET /:id/health-score — current score + 7-day history
  app.get('/:id/health-score', async (c) => {
    const connectorId = c.req.param('id');
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 90);

    const [scoreResult, historyResult] = await Promise.all([
      scorer.scoreConnector(connectorId, workspaceId),
      scorer.getHealthHistory(connectorId, workspaceId, days),
    ]);

    if (scoreResult.isErr()) {
      return c.json({ error: { code: 'SCORE_FAILED', message: scoreResult.error.message } }, 500);
    }

    return c.json({
      data: {
        current: scoreResult.value,
        history: historyResult.isOk() ? historyResult.value : [],
      },
    });
  });

  // POST /:id/sla-config — create or update SLA target
  app.post('/:id/sla-config', zValidator('json', SlaTargetSchema), async (c) => {
    const connectorId = c.req.param('id');
    const { workspaceId, minHealthScore, minSyncSuccessRate, maxSyncLatencySeconds, uptimeTargetPct, measurementWindowDays } = c.req.valid('json');

    try {
      const rows = await sql`
        INSERT INTO sla_targets
          (connector_id, workspace_id, min_health_score, min_sync_success_rate,
           max_sync_latency_seconds, uptime_target_pct, measurement_window_days)
        VALUES
          (${connectorId}, ${workspaceId}, ${minHealthScore}, ${minSyncSuccessRate},
           ${maxSyncLatencySeconds}, ${uptimeTargetPct}, ${measurementWindowDays})
        ON CONFLICT (connector_id, workspace_id) DO UPDATE
          SET min_health_score = EXCLUDED.min_health_score,
              min_sync_success_rate = EXCLUDED.min_sync_success_rate,
              max_sync_latency_seconds = EXCLUDED.max_sync_latency_seconds,
              uptime_target_pct = EXCLUDED.uptime_target_pct,
              measurement_window_days = EXCLUDED.measurement_window_days
        RETURNING *
      ` as SlaTargetRow[];

      const row = rows[0]!;
      return c.json({
        data: {
          targetId: row.target_id,
          connectorId: row.connector_id,
          workspaceId: row.workspace_id,
          minHealthScore: row.min_health_score,
          minSyncSuccessRate: row.min_sync_success_rate,
          maxSyncLatencySeconds: row.max_sync_latency_seconds,
          uptimeTargetPct: row.uptime_target_pct,
          measurementWindowDays: row.measurement_window_days,
          createdAt: row.created_at,
        },
      }, 201);
    } catch (err) {
      logger.error('Failed to set SLA config', { connectorId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'SLA_CONFIG_FAILED', message: 'Failed to save SLA configuration' } }, 500);
    }
  });

  // GET /health-summary — all connectors ranked by health score
  app.get('/health-summary', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    try {
      const rows = await sql`
        SELECT DISTINCT ON (connector_id)
          connector_id, overall_score, sync_success_rate, entity_freshness,
          error_frequency, auth_validity, scored_at
        FROM connector_health_scores
        WHERE workspace_id = ${workspaceId}
        ORDER BY connector_id, scored_at DESC
      ` as Array<{
        connector_id: string;
        overall_score: number;
        sync_success_rate: number;
        entity_freshness: number;
        error_frequency: number;
        auth_validity: number;
        scored_at: Date;
      }>;

      const ranked = rows
        .sort((a, b) => b.overall_score - a.overall_score)
        .map((r) => ({
          connectorId: r.connector_id,
          overallScore: r.overall_score,
          grade: scoreToGrade(r.overall_score),
          syncSuccessRate: r.sync_success_rate,
          entityFreshness: r.entity_freshness,
          errorFrequency: r.error_frequency,
          authValidity: r.auth_validity,
          scoredAt: r.scored_at,
        }));

      return c.json({ data: ranked });
    } catch (err) {
      logger.error('Failed to fetch health summary', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch health summary' } }, 500);
    }
  });

  // GET /incidents — active health alerts across workspace
  app.get('/incidents', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const alertsResult = await scorer.listActiveAlerts(workspaceId);
    if (alertsResult.isErr()) {
      return c.json({ error: { code: 'FETCH_FAILED', message: alertsResult.error.message } }, 500);
    }
    return c.json({ data: alertsResult.value });
  });

  // POST /incidents/:alertId/resolve — resolve an alert
  app.post('/incidents/:alertId/resolve', zValidator('json', ResolveAlertSchema), async (c) => {
    const alertId = c.req.param('alertId');
    const { workspaceId } = c.req.valid('json');
    const result = await scorer.resolveAlert(alertId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'RESOLVE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { alertId, resolved: true } });
  });

  // GET /:id/sla-breaches — SLA breach timeline for a connector
  app.get('/:id/sla-breaches', async (c) => {
    const connectorId = c.req.param('id');
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    try {
      const rows = await sql`
        SELECT breach_id, connector_id, workspace_id, breach_type,
               actual_value, target_value, breach_started_at, breach_resolved_at, description
        FROM sla_breaches
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
        ORDER BY breach_started_at DESC
        LIMIT 50
      ` as SlaBreachRow[];

      return c.json({
        data: rows.map((r) => ({
          breachId: r.breach_id,
          breachType: r.breach_type,
          actualValue: r.actual_value,
          targetValue: r.target_value,
          breachStartedAt: r.breach_started_at,
          breachResolvedAt: r.breach_resolved_at,
          description: r.description,
        })),
      });
    } catch (err) {
      logger.error('Failed to fetch SLA breaches', { connectorId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch SLA breaches' } }, 500);
    }
  });

  // POST /:id/recovery — trigger a recovery action
  app.post('/:id/recovery', zValidator('json', RecoveryActionSchema), async (c) => {
    const connectorId = c.req.param('id');
    const { workspaceId, actionType } = c.req.valid('json');
    const result = await scorer.executeRecoveryAction(connectorId, workspaceId, actionType);
    if (result.isErr()) {
      return c.json({ error: { code: 'RECOVERY_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  // GET /:id/recovery-suggestions — get recovery recommendations
  app.get('/:id/recovery-suggestions', async (c) => {
    const connectorId = c.req.param('id');
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const result = await scorer.suggestRecovery(connectorId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'FETCH_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
