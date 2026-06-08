import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'compliance-reporter' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventType = 'access' | 'export' | 'delete' | 'modify' | 'share';
export type AlertType = 'unusual_time' | 'bulk_export' | 'new_location' | 'high_volume' | 'pii_access';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DsrType = 'access' | 'deletion' | 'portability' | 'correction';
export type DsrStatus = 'pending' | 'processing' | 'completed' | 'rejected';
export type ComplianceFramework = 'hipaa' | 'soc2' | 'gdpr' | 'ccpa';

export interface ComplianceEvent {
  id: string;
  workspaceId: string;
  eventType: EventType;
  entityId: string | null;
  accessedFields: string[];
  userId: string;
  toolName: string | null;
  ipAddress: string | null;
  occurredAt: string;
}

export interface AnomalyAlert {
  id: string;
  workspaceId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  userId: string;
  description: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface DataSubjectRequest {
  id: string;
  workspaceId: string;
  requestType: DsrType;
  subjectEmail: string;
  submittedBy: string;
  status: DsrStatus;
  entityIds: string[];
  completedAt: string | null;
  createdAt: string;
}

export interface RecordEventInput {
  workspaceId: string;
  eventType: EventType;
  entityId?: string;
  accessedFields?: string[];
  userId: string;
  toolName?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface ComplianceReport {
  framework: ComplianceFramework;
  workspaceId: string;
  generatedAt: string;
  totalEvents: number;
  periodStart: string;
  periodEnd: string;
  eventsByType: Record<string, number>;
  uniqueUsers: number;
  piiAccessCount: number;
  anomaliesDetected: number;
  dataRetentionStatus: 'compliant' | 'review_needed' | 'non_compliant';
  openDsrCount: number;
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  workspace_id: string;
  event_type: EventType;
  entity_id: string | null;
  accessed_fields: string[];
  user_id: string;
  tool_name: string | null;
  ip_address: string | null;
  occurred_at: string;
}

interface AlertRow {
  id: string;
  workspace_id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  user_id: string;
  description: string;
  acknowledged: boolean;
  created_at: string;
}

interface DsrRow {
  id: string;
  workspace_id: string;
  request_type: DsrType;
  subject_email: string;
  submitted_by: string;
  status: DsrStatus;
  entity_ids: string[];
  completed_at: string | null;
  created_at: string;
}

interface CountRow {
  event_type: string;
  count: string;
}

interface SummaryRow {
  total_events: string;
  unique_users: string;
  pii_access_count: string;
}

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Records compliance events, detects anomalies, generates regulatory reports,
 * and handles Data Subject Requests (DSR) for HIPAA, SOC2, GDPR, and CCPA.
 */
export class ComplianceReporter {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Records a data access or mutation event to the compliance audit log.
   *
   * @param input - Event details
   */
  async recordEvent(input: RecordEventInput): Promise<Result<ComplianceEvent, Error>> {
    try {
      const fields = input.accessedFields ?? [];
      const [row] = await this.sql`
        INSERT INTO compliance_events
          (workspace_id, event_type, entity_id, accessed_fields, user_id, tool_name, ip_address, metadata)
        VALUES (
          ${input.workspaceId},
          ${input.eventType},
          ${input.entityId ?? null},
          ${fields},
          ${input.userId},
          ${input.toolName ?? null},
          ${input.ipAddress ?? null},
          ${input.metadata ? JSON.stringify(input.metadata) : null}
        )
        RETURNING *
      ` as EventRow[];

      if (!row) return err(new Error('Insert failed'));

      void this.detectAnomalies(input.workspaceId, input.userId, input.eventType, input.ipAddress ?? null);

      log.info('Compliance event recorded', {
        workspaceId: input.workspaceId,
        eventType: input.eventType,
        userId: input.userId,
      });

      return ok(rowToEvent(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Queries the audit log with filters.
   *
   * @param workspaceId - Target workspace
   * @param options - Filter options
   */
  async getAuditLog(
    workspaceId: string,
    options: { userId?: string; entityId?: string; eventType?: EventType; limit?: number } = {},
  ): Promise<Result<ComplianceEvent[], Error>> {
    try {
      const limit = options.limit ?? 100;
      const rows = await this.sql`
        SELECT * FROM compliance_events
        WHERE workspace_id = ${workspaceId}
          AND (${options.userId ?? null} IS NULL OR user_id = ${options.userId ?? null})
          AND (${options.entityId ?? null} IS NULL OR entity_id = ${options.entityId ?? null})
          AND (${options.eventType ?? null} IS NULL OR event_type = ${options.eventType ?? null})
        ORDER BY occurred_at DESC
        LIMIT ${limit}
      ` as EventRow[];

      return ok(rows.map(rowToEvent));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generates a compliance report for the specified framework.
   *
   * @param workspaceId - Target workspace
   * @param framework - Compliance framework (hipaa, soc2, gdpr, ccpa)
   * @param days - Reporting window in days (default: 30)
   */
  async generateReport(workspaceId: string, framework: ComplianceFramework, days = 30): Promise<Result<ComplianceReport, Error>> {
    try {
      const periodStart = new Date(Date.now() - days * 86_400_000).toISOString();
      const periodEnd = new Date().toISOString();

      const [summary, byType, openDsrs, anomalies] = await Promise.all([
        this.sql`
          SELECT
            COUNT(*)::TEXT AS total_events,
            COUNT(DISTINCT user_id)::TEXT AS unique_users,
            COUNT(*) FILTER (WHERE array_length(accessed_fields, 1) > 0)::TEXT AS pii_access_count
          FROM compliance_events
          WHERE workspace_id = ${workspaceId}
            AND occurred_at >= ${periodStart}
        ` as Promise<SummaryRow[]>,
        this.sql`
          SELECT event_type, COUNT(*)::TEXT AS count
          FROM compliance_events
          WHERE workspace_id = ${workspaceId}
            AND occurred_at >= ${periodStart}
          GROUP BY event_type
        ` as Promise<CountRow[]>,
        this.sql`
          SELECT COUNT(*)::TEXT AS count
          FROM data_subject_requests
          WHERE workspace_id = ${workspaceId}
            AND status IN ('pending', 'processing')
        ` as Promise<Array<{ count: string }>>,
        this.sql`
          SELECT COUNT(*)::TEXT AS count
          FROM anomaly_alerts
          WHERE workspace_id = ${workspaceId}
            AND created_at >= ${periodStart}
        ` as Promise<Array<{ count: string }>>,
      ]);

      const s = summary[0] ?? { total_events: '0', unique_users: '0', pii_access_count: '0' };
      const eventsByType = Object.fromEntries(byType.map((r) => [r.event_type, parseInt(r.count, 10)]));
      const openDsrCount = parseInt(openDsrs[0]?.count ?? '0', 10);
      const anomaliesDetected = parseInt(anomalies[0]?.count ?? '0', 10);

      const dataRetentionStatus: ComplianceReport['dataRetentionStatus'] =
        framework === 'hipaa' && openDsrCount > 0 ? 'review_needed'
          : anomaliesDetected > 10 ? 'review_needed'
          : 'compliant';

      log.info('Compliance report generated', { workspaceId, framework, days });

      return ok({
        framework,
        workspaceId,
        generatedAt: new Date().toISOString(),
        totalEvents: parseInt(s.total_events, 10),
        periodStart,
        periodEnd,
        eventsByType,
        uniqueUsers: parseInt(s.unique_users, 10),
        piiAccessCount: parseInt(s.pii_access_count, 10),
        anomaliesDetected,
        dataRetentionStatus,
        openDsrCount,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Creates a Data Subject Request (GDPR Article 15/17, CCPA, HIPAA access request).
   *
   * @param workspaceId - Target workspace
   * @param requestType - Type of request
   * @param subjectEmail - Email of the data subject
   * @param submittedBy - User submitting the request
   */
  async createDsr(workspaceId: string, requestType: DsrType, subjectEmail: string, submittedBy: string): Promise<Result<DataSubjectRequest, Error>> {
    try {
      const [row] = await this.sql`
        INSERT INTO data_subject_requests (workspace_id, request_type, subject_email, submitted_by)
        VALUES (${workspaceId}, ${requestType}, ${subjectEmail}, ${submittedBy})
        RETURNING *
      ` as DsrRow[];

      if (!row) return err(new Error('Insert failed'));
      log.info('DSR created', { workspaceId, requestType, subjectEmail });
      return ok(rowToDsr(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists all DSRs for a workspace.
   *
   * @param workspaceId - Target workspace
   * @param status - Filter by status (optional)
   */
  async listDsrs(workspaceId: string, status?: DsrStatus): Promise<Result<DataSubjectRequest[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM data_subject_requests
        WHERE workspace_id = ${workspaceId}
          AND (${status ?? null} IS NULL OR status = ${status ?? null})
        ORDER BY created_at DESC
        LIMIT 50
      ` as DsrRow[];
      return ok(rows.map(rowToDsr));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns open anomaly alerts for a workspace.
   *
   * @param workspaceId - Target workspace
   */
  async getAlerts(workspaceId: string): Promise<Result<AnomalyAlert[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM anomaly_alerts
        WHERE workspace_id = ${workspaceId}
          AND acknowledged = FALSE
        ORDER BY created_at DESC
        LIMIT 100
      ` as AlertRow[];
      return ok(rows.map(rowToAlert));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Acknowledges an anomaly alert.
   *
   * @param alertId - Alert to acknowledge
   * @param acknowledgedBy - User acknowledging the alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE anomaly_alerts
        SET acknowledged = TRUE,
            acknowledged_by = ${acknowledgedBy},
            acknowledged_at = NOW()
        WHERE id = ${alertId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // Runs fire-and-forget after each event to look for patterns
  private async detectAnomalies(
    workspaceId: string,
    userId: string,
    eventType: EventType,
    ipAddress: string | null,
  ): Promise<void> {
    try {
      const hour = new Date().getHours();
      const isOffHours = hour < 6 || hour > 22;

      if (isOffHours) {
        await this.sql`
          INSERT INTO anomaly_alerts (workspace_id, alert_type, severity, user_id, description, event_ids)
          VALUES (
            ${workspaceId}, 'unusual_time', 'medium', ${userId},
            ${`Access by ${userId} at unusual hour (${hour}:00)`}, '{}'
          )
          ON CONFLICT DO NOTHING
        `;
      }

      if (eventType === 'export') {
        const [recent] = await this.sql`
          SELECT COUNT(*)::TEXT AS count
          FROM compliance_events
          WHERE workspace_id = ${workspaceId}
            AND user_id = ${userId}
            AND event_type = 'export'
            AND occurred_at > NOW() - INTERVAL '1 hour'
        ` as Array<{ count: string }>;

        const exportCount = parseInt(recent?.count ?? '0', 10);
        if (exportCount >= 10) {
          await this.sql`
            INSERT INTO anomaly_alerts (workspace_id, alert_type, severity, user_id, description, event_ids)
            VALUES (
              ${workspaceId}, 'bulk_export', 'high', ${userId},
              ${`Bulk export: ${exportCount} exports by ${userId} in the last hour`}, '{}'
            )
          `;
        }
      }
    } catch {
      // Anomaly detection failures are non-fatal — do not propagate
    }
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToEvent(r: EventRow): ComplianceEvent {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    eventType: r.event_type,
    entityId: r.entity_id,
    accessedFields: r.accessed_fields,
    userId: r.user_id,
    toolName: r.tool_name,
    ipAddress: r.ip_address,
    occurredAt: r.occurred_at,
  };
}

function rowToAlert(r: AlertRow): AnomalyAlert {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    alertType: r.alert_type,
    severity: r.severity,
    userId: r.user_id,
    description: r.description,
    acknowledged: r.acknowledged,
    createdAt: r.created_at,
  };
}

function rowToDsr(r: DsrRow): DataSubjectRequest {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    requestType: r.request_type,
    subjectEmail: r.subject_email,
    submittedBy: r.submitted_by,
    status: r.status,
    entityIds: r.entity_ids,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}
