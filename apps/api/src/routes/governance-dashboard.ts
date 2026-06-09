import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

const RetentionPolicySchema = z.object({
  workspaceId: z.string().min(1),
  connectorId: z.string().min(1),
  entityType: z.string().min(1),
  ttlDays: z.number().int().positive().max(3650),
  appliesToLabels: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

const DsrRequestSchema = z.object({
  workspaceId: z.string().min(1),
  requesterEmail: z.string().email(),
  requestType: z.enum(['deletion', 'export', 'rectification', 'access']),
  entityIds: z.array(z.string()).min(1),
  notes: z.string().optional(),
  deadlineAt: z.string().datetime().optional(),
});

const ComplianceUpdateSchema = z.object({
  workspaceId: z.string().min(1),
  gdprStatus: z.enum(['compliant', 'non_compliant', 'not_assessed', 'in_progress']).optional(),
  hipaaStatus: z.enum(['compliant', 'non_compliant', 'not_assessed', 'in_progress']).optional(),
  soc2Status: z.enum(['compliant', 'non_compliant', 'not_assessed', 'in_progress']).optional(),
  gdprCertExpiresAt: z.string().datetime().optional(),
  hipaaCertExpiresAt: z.string().datetime().optional(),
  soc2CertExpiresAt: z.string().datetime().optional(),
  scopeSummary: z.string().optional(),
});

type RetentionPolicyRow = {
  policy_id: string;
  workspace_id: string;
  connector_id: string;
  entity_type: string;
  ttl_days: number;
  applies_to_labels: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type ComplianceRow = {
  compliance_id: string;
  workspace_id: string;
  gdpr_status: string;
  hipaa_status: string;
  soc2_status: string;
  gdpr_cert_expires_at: Date | null;
  hipaa_cert_expires_at: Date | null;
  soc2_cert_expires_at: Date | null;
  last_audit_at: Date | null;
  scope_summary: string | null;
  created_at: Date;
  updated_at: Date;
};

type DsrRow = {
  request_id: string;
  workspace_id: string;
  requester_email: string;
  request_type: string;
  status: string;
  entity_ids: string[];
  notes: string | null;
  submitted_at: Date;
  completed_at: Date | null;
  deadline_at: Date;
};

type AuditRow = {
  event_id: string;
  workspace_id: string;
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string;
  duration_ms: number;
  bytes_returned: number;
  created_at: Date;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for governance dashboard
 */
export function createGovernanceDashboardRoutes(sql: Sql) {
  const app = new Hono();

  // GET /governance/lineage — entity flow data for lineage viewer
  app.get('/lineage', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    try {
      const [connectorRows, entityCounts] = await Promise.all([
        sql`
          SELECT DISTINCT connector_id, entity_type, COUNT(*) AS entity_count
          FROM entities
          WHERE workspace_id = ${workspaceId}
          GROUP BY connector_id, entity_type
          ORDER BY connector_id, entity_type
        ` as Promise<Array<{ connector_id: string; entity_type: string; entity_count: string }>>,
        sql`
          SELECT entity_type, COUNT(*) AS total, MAX(updated_at) AS last_updated
          FROM entities
          WHERE workspace_id = ${workspaceId}
          GROUP BY entity_type
        ` as Promise<Array<{ entity_type: string; total: string; last_updated: Date }>>,
      ]);

      const nodes = connectorRows.map((r) => ({
        id: `connector:${r.connector_id}:${r.entity_type}`,
        connectorId: r.connector_id,
        entityType: r.entity_type,
        entityCount: parseInt(r.entity_count, 10),
      }));

      const entitySummary = entityCounts.map((r) => ({
        entityType: r.entity_type,
        total: parseInt(r.total, 10),
        lastUpdated: r.last_updated,
      }));

      return c.json({ data: { nodes, entitySummary } });
    } catch (err) {
      logger.error('Failed to fetch lineage data', { workspaceId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ data: { nodes: [], entitySummary: [] } });
    }
  });

  // GET /governance/audit-summary — aggregate audit stats
  app.get('/audit-summary', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    try {
      const [events, stats] = await Promise.all([
        sql`
          SELECT event_id, workspace_id, actor, action, resource_type, resource_id,
                 duration_ms, bytes_returned, created_at
          FROM audit_log
          WHERE workspace_id = ${workspaceId}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        ` as Promise<AuditRow[]>,
        sql`
          SELECT
            COUNT(*) AS total_events,
            COALESCE(AVG(duration_ms), 0) AS avg_duration_ms,
            COALESCE(SUM(bytes_returned), 0) AS total_bytes,
            COUNT(DISTINCT actor) AS unique_actors
          FROM audit_log
          WHERE workspace_id = ${workspaceId}
            AND created_at > NOW() - INTERVAL '30 days'
        ` as Promise<Array<{ total_events: string; avg_duration_ms: string; total_bytes: string; unique_actors: string }>>,
      ]);

      const stat = stats[0] ?? { total_events: '0', avg_duration_ms: '0', total_bytes: '0', unique_actors: '0' };

      return c.json({
        data: {
          events: events.map((e) => ({
            eventId: e.event_id,
            actor: e.actor,
            action: e.action,
            resourceType: e.resource_type,
            resourceId: e.resource_id,
            durationMs: e.duration_ms,
            bytesReturned: e.bytes_returned,
            createdAt: e.created_at,
          })),
          stats: {
            totalEvents: parseInt(stat.total_events, 10),
            avgDurationMs: parseFloat(stat.avg_duration_ms),
            totalBytes: parseInt(stat.total_bytes, 10),
            uniqueActors: parseInt(stat.unique_actors, 10),
          },
        },
        meta: { offset, limit },
      });
    } catch (err) {
      logger.error('Failed to fetch audit summary', { workspaceId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch audit data' } }, 500);
    }
  });

  // POST /governance/retention-policies — create or upsert policy
  app.post('/retention-policies', zValidator('json', RetentionPolicySchema), async (c) => {
    const { workspaceId, connectorId, entityType, ttlDays, appliesToLabels, isActive } = c.req.valid('json');
    try {
      const rows = await sql`
        INSERT INTO retention_policies
          (workspace_id, connector_id, entity_type, ttl_days, applies_to_labels, is_active)
        VALUES
          (${workspaceId}, ${connectorId}, ${entityType}, ${ttlDays}, ${appliesToLabels}, ${isActive})
        ON CONFLICT (workspace_id, connector_id, entity_type) DO UPDATE
          SET ttl_days = EXCLUDED.ttl_days,
              applies_to_labels = EXCLUDED.applies_to_labels,
              is_active = EXCLUDED.is_active,
              updated_at = NOW()
        RETURNING *
      ` as RetentionPolicyRow[];

      const policy = rows[0]!;
      return c.json({
        data: {
          policyId: policy.policy_id,
          workspaceId: policy.workspace_id,
          connectorId: policy.connector_id,
          entityType: policy.entity_type,
          ttlDays: policy.ttl_days,
          appliesToLabels: policy.applies_to_labels,
          isActive: policy.is_active,
          createdAt: policy.created_at,
        },
      }, 201);
    } catch (err) {
      logger.error('Failed to create retention policy', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'CREATE_FAILED', message: 'Failed to create retention policy' } }, 500);
    }
  });

  // GET /governance/retention-policies — list policies for workspace
  app.get('/retention-policies', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    try {
      const rows = await sql`
        SELECT policy_id, workspace_id, connector_id, entity_type, ttl_days,
               applies_to_labels, is_active, created_at, updated_at
        FROM retention_policies
        WHERE workspace_id = ${workspaceId}
        ORDER BY connector_id, entity_type
      ` as RetentionPolicyRow[];

      return c.json({
        data: rows.map((r) => ({
          policyId: r.policy_id,
          connectorId: r.connector_id,
          entityType: r.entity_type,
          ttlDays: r.ttl_days,
          appliesToLabels: r.applies_to_labels,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      logger.error('Failed to fetch retention policies', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch policies' } }, 500);
    }
  });

  // GET /governance/compliance-status — workspace compliance status
  app.get('/compliance-status', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    try {
      const rows = await sql`
        SELECT *
        FROM compliance_metadata
        WHERE workspace_id = ${workspaceId}
      ` as ComplianceRow[];

      if (rows.length === 0) {
        return c.json({
          data: {
            workspaceId,
            gdprStatus: 'not_assessed',
            hipaaStatus: 'not_assessed',
            soc2Status: 'not_assessed',
            lastAuditAt: null,
            scopeSummary: null,
          },
        });
      }

      const row = rows[0]!;
      return c.json({
        data: {
          workspaceId,
          gdprStatus: row.gdpr_status,
          hipaaStatus: row.hipaa_status,
          soc2Status: row.soc2_status,
          gdprCertExpiresAt: row.gdpr_cert_expires_at,
          hipaaCertExpiresAt: row.hipaa_cert_expires_at,
          soc2CertExpiresAt: row.soc2_cert_expires_at,
          lastAuditAt: row.last_audit_at,
          scopeSummary: row.scope_summary,
        },
      });
    } catch (err) {
      logger.error('Failed to fetch compliance status', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch compliance status' } }, 500);
    }
  });

  // PUT /governance/compliance-status — update compliance metadata
  app.put('/compliance-status', zValidator('json', ComplianceUpdateSchema), async (c) => {
    const body = c.req.valid('json');
    const { workspaceId, ...rest } = body;
    try {
      await sql`
        INSERT INTO compliance_metadata
          (workspace_id, gdpr_status, hipaa_status, soc2_status,
           gdpr_cert_expires_at, hipaa_cert_expires_at, soc2_cert_expires_at, scope_summary)
        VALUES
          (${workspaceId},
           ${rest.gdprStatus ?? 'not_assessed'},
           ${rest.hipaaStatus ?? 'not_assessed'},
           ${rest.soc2Status ?? 'not_assessed'},
           ${rest.gdprCertExpiresAt ?? null},
           ${rest.hipaaCertExpiresAt ?? null},
           ${rest.soc2CertExpiresAt ?? null},
           ${rest.scopeSummary ?? null})
        ON CONFLICT (workspace_id) DO UPDATE
          SET gdpr_status = COALESCE(EXCLUDED.gdpr_status, compliance_metadata.gdpr_status),
              hipaa_status = COALESCE(EXCLUDED.hipaa_status, compliance_metadata.hipaa_status),
              soc2_status = COALESCE(EXCLUDED.soc2_status, compliance_metadata.soc2_status),
              gdpr_cert_expires_at = COALESCE(EXCLUDED.gdpr_cert_expires_at, compliance_metadata.gdpr_cert_expires_at),
              hipaa_cert_expires_at = COALESCE(EXCLUDED.hipaa_cert_expires_at, compliance_metadata.hipaa_cert_expires_at),
              soc2_cert_expires_at = COALESCE(EXCLUDED.soc2_cert_expires_at, compliance_metadata.soc2_cert_expires_at),
              scope_summary = COALESCE(EXCLUDED.scope_summary, compliance_metadata.scope_summary),
              updated_at = NOW()
      `;
      return c.json({ data: { updated: true } });
    } catch (err) {
      logger.error('Failed to update compliance metadata', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to update compliance status' } }, 500);
    }
  });

  // POST /governance/dsr-queue — submit a data subject request
  app.post('/dsr-queue', zValidator('json', DsrRequestSchema), async (c) => {
    const { workspaceId, requesterEmail, requestType, entityIds, notes, deadlineAt } = c.req.valid('json');
    try {
      const rows = await sql`
        INSERT INTO dsr_queue
          (workspace_id, requester_email, request_type, entity_ids, notes, deadline_at)
        VALUES
          (${workspaceId}, ${requesterEmail}, ${requestType}, ${entityIds},
           ${notes ?? null}, ${deadlineAt ?? null})
        RETURNING request_id, status, submitted_at, deadline_at
      ` as Array<{ request_id: string; status: string; submitted_at: Date; deadline_at: Date }>;

      const row = rows[0]!;
      return c.json({
        data: {
          requestId: row.request_id,
          status: row.status,
          submittedAt: row.submitted_at,
          deadlineAt: row.deadline_at,
        },
      }, 201);
    } catch (err) {
      logger.error('Failed to submit DSR', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'DSR_FAILED', message: 'Failed to submit data subject request' } }, 500);
    }
  });

  // GET /governance/dsr-queue — list DSR requests
  app.get('/dsr-queue', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const status = c.req.query('status');
    try {
      let rows: DsrRow[];
      if (status) {
        rows = await sql`
          SELECT request_id, workspace_id, requester_email, request_type, status,
                 entity_ids, notes, submitted_at, completed_at, deadline_at
          FROM dsr_queue
          WHERE workspace_id = ${workspaceId} AND status = ${status}
          ORDER BY submitted_at DESC
        ` as DsrRow[];
      } else {
        rows = await sql`
          SELECT request_id, workspace_id, requester_email, request_type, status,
                 entity_ids, notes, submitted_at, completed_at, deadline_at
          FROM dsr_queue
          WHERE workspace_id = ${workspaceId}
          ORDER BY submitted_at DESC
        ` as DsrRow[];
      }

      return c.json({
        data: rows.map((r) => ({
          requestId: r.request_id,
          requesterEmail: r.requester_email,
          requestType: r.request_type,
          status: r.status,
          entityCount: r.entity_ids.length,
          notes: r.notes,
          submittedAt: r.submitted_at,
          completedAt: r.completed_at,
          deadlineAt: r.deadline_at,
        })),
      });
    } catch (err) {
      logger.error('Failed to fetch DSR queue', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch DSR queue' } }, 500);
    }
  });

  // PATCH /governance/dsr-queue/:id/status — update DSR status
  app.patch('/dsr-queue/:id/status', zValidator('json', z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  })), async (c) => {
    const requestId = c.req.param('id');
    const { status } = c.req.valid('json');
    try {
      await sql`
        UPDATE dsr_queue
        SET status = ${status},
            completed_at = CASE WHEN ${status} IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE NULL END
        WHERE request_id = ${requestId}
      `;
      return c.json({ data: { requestId, status } });
    } catch (err) {
      logger.error('Failed to update DSR status', { requestId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to update DSR status' } }, 500);
    }
  });

  return app;
}
