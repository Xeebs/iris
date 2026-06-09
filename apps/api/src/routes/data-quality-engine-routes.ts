import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'data-quality-engine-routes' });

const RemediationApplySchema = z.object({
  workspaceId: z.string().min(1),
});

type ScoreRow = {
  entity_type: string;
  entity_count: string;
  avg_completeness: string;
  avg_freshness: string;
  avg_accuracy: string;
  avg_overall: string;
};

type IssueRow = {
  issue_id: string;
  workspace_id: string;
  issue_type: string;
  entity_type: string;
  affected_count: number;
  severity: string;
  description: string | null;
  first_detected_at: Date;
};

type ActionRow = {
  action_id: string;
  issue_id: string;
  action_type: string;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for data quality engine endpoints
 */
export function createDataQualityEngineRoutes(sql: Sql) {
  const app = new Hono();

  // GET /quality2/score — workspace overall quality score
  app.get('/score', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';

    try {
      const rows = await sql`
        SELECT workspace_id,
               SUM(overall_score * entity_count_per_type) / NULLIF(SUM(entity_count_per_type), 0) AS weighted_overall
        FROM (
          SELECT workspace_id, entity_type, AVG(overall_score) AS overall_score, COUNT(*) AS entity_count_per_type
          FROM data_quality_scores
          WHERE workspace_id = ${workspaceId}
          GROUP BY workspace_id, entity_type
        ) sub
        GROUP BY workspace_id
      ` as Array<{ workspace_id: string; weighted_overall: string }>;

      const overallScore = rows.length > 0 ? parseFloat(rows[0]!.weighted_overall) : 0;
      return c.json({ data: { workspaceId, overallScore: Math.round(overallScore * 100) / 100, assessedAt: new Date() } });
    } catch (err) {
      log.error('Failed to fetch workspace score', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch quality score' } }, 500);
    }
  });

  // GET /quality2/by-type — quality scores per entity type
  app.get('/by-type', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';

    try {
      const rows = await sql`
        SELECT entity_type, COUNT(*) AS entity_count,
               AVG(completeness_score) AS avg_completeness, AVG(freshness_score) AS avg_freshness,
               AVG(accuracy_score) AS avg_accuracy, AVG(overall_score) AS avg_overall
        FROM data_quality_scores
        WHERE workspace_id = ${workspaceId}
        GROUP BY entity_type
        ORDER BY avg_overall ASC
      ` as ScoreRow[];

      return c.json({
        data: rows.map((r) => ({
          entityType: r.entity_type,
          entityCount: parseInt(r.entity_count, 10),
          avgCompletenessScore: parseFloat(r.avg_completeness),
          avgFreshnessScore: parseFloat(r.avg_freshness),
          avgAccuracyScore: parseFloat(r.avg_accuracy),
          avgOverallScore: Math.round(parseFloat(r.avg_overall) * 100) / 100,
        })),
        meta: { total: rows.length },
      });
    } catch (err) {
      log.error('Failed to fetch scores by type', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch scores by type' } }, 500);
    }
  });

  // GET /quality2/issues — list detected issues
  app.get('/issues', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const severity = c.req.query('severity');

    try {
      let rows: IssueRow[];
      if (severity) {
        rows = await sql`
          SELECT issue_id, workspace_id, issue_type, entity_type, affected_count,
                 severity, description, first_detected_at
          FROM quality_issues
          WHERE workspace_id = ${workspaceId} AND severity = ${severity} AND resolved_at IS NULL
          ORDER BY first_detected_at DESC
        ` as IssueRow[];
      } else {
        rows = await sql`
          SELECT issue_id, workspace_id, issue_type, entity_type, affected_count,
                 severity, description, first_detected_at
          FROM quality_issues
          WHERE workspace_id = ${workspaceId} AND resolved_at IS NULL
          ORDER BY CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                   first_detected_at DESC
        ` as IssueRow[];
      }

      return c.json({
        data: rows.map((r) => ({
          issueId: r.issue_id, issueType: r.issue_type, entityType: r.entity_type,
          affectedCount: r.affected_count, severity: r.severity,
          description: r.description, firstDetectedAt: r.first_detected_at,
        })),
        meta: { total: rows.length },
      });
    } catch (err) {
      log.error('Failed to fetch quality issues', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch quality issues' } }, 500);
    }
  });

  // POST /quality2/issues/:id/apply-remediation
  app.post('/issues/:id/apply-remediation', zValidator('json', RemediationApplySchema), async (c) => {
    const issueId = c.req.param('id');
    const { workspaceId } = c.req.valid('json');

    try {
      const actionRows = await sql`
        SELECT action_id, action_type
        FROM remediation_actions
        WHERE issue_id = ${issueId} AND status = 'pending'
        ORDER BY created_at ASC LIMIT 1
      ` as ActionRow[];

      if (actionRows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'No pending remediation action found' } }, 404);
      }

      const action = actionRows[0]!;

      await sql`UPDATE remediation_actions SET status = 'applied', applied_at = NOW() WHERE action_id = ${action.action_id}`;
      await sql`UPDATE quality_issues SET resolved_at = NOW() WHERE issue_id = ${issueId} AND workspace_id = ${workspaceId}`;

      log.info('Remediation applied', { issueId, actionType: action.action_type, workspaceId });
      return c.json({ data: { issueId, actionType: action.action_type, status: 'applied' } });
    } catch (err) {
      log.error('Failed to apply remediation', { issueId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'APPLY_FAILED', message: 'Failed to apply remediation' } }, 500);
    }
  });

  return app;
}
