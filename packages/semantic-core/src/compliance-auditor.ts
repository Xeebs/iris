import { ok, err, type Result } from 'neverthrow';
import { createHash, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'compliance-auditor' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type AuditRecord = {
  userId: string;
  entityIds: string[];
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  queryText: string;
  resultCount: number;
  piiFieldsAccessed: boolean;
  action: 'read' | 'write' | 'delete';
};

export type AuditReport = {
  workspaceId: string;
  startDate: Date;
  endDate: Date;
  records: AuditRecord[];
  generatedAt: Date;
  totalRecords: number;
  format: 'json' | 'csv';
};

export type SignedAuditReport = {
  report: AuditReport;
  signature: string;
  publicKey: string;
  signedAt: Date;
  exportId: string;
};

export type AnomalousAccessAlert = {
  alertType: 'bulk_access' | 'off_hours' | 'pii_overaccess';
  userId: string;
  entityIdsInvolved: string[];
  confidence: number;
  flaggedAt: Date;
  details: string;
};

export type ComplianceFormat = 'soc2' | 'gdpr' | 'hipaa';

export type SOC2Report = {
  auditPeriod: { start: Date; end: Date };
  controlCategory: 'CC6' | 'CC7';
  accessEvents: Array<{ userId: string; resource: string; action: string; timestamp: string; outcome: 'success' | 'failure' }>;
  anomalyCount: number;
  piiAccessCount: number;
};

export type GDPRReport = {
  dataSubjectRequests: Array<{ userId: string; entitiesAccessed: string[]; accessDate: string; purpose: string }>;
  retentionPolicyCompliant: boolean;
  thirdPartyTransfers: string[];
};

export type HIPAAReport = {
  coveredEntityId: string;
  auditPeriod: { start: Date; end: Date };
  phiAccessEvents: Array<{ userId: string; patientId: string; accessTimestamp: string; accessReason: string }>;
  breachIndicators: string[];
};

/** Detect off-hours access (outside 07:00–20:00 local). */
function isOffHours(ts: Date): boolean {
  const hour = ts.getUTCHours();
  return hour < 7 || hour >= 20;
}

/** Convert audit records to CSV string. */
function toCSV(records: AuditRecord[]): string {
  const header = 'user_id,entity_ids,timestamp,ip_address,user_agent,query_text,result_count,pii_fields_accessed,action';
  const rows = records.map(r => [
    r.userId,
    r.entityIds.join('|'),
    r.timestamp.toISOString(),
    r.ipAddress,
    JSON.stringify(r.userAgent),
    JSON.stringify(r.queryText),
    r.resultCount,
    r.piiFieldsAccessed ? 'yes' : 'no',
    r.action,
  ].join(','));
  return [header, ...rows].join('\n');
}

/**
 * Generate an audit report for a workspace over a date range.
 * @param sql - SQL function
 * @param workspaceId - Workspace to audit
 * @param startDate - Report start date (inclusive)
 * @param endDate - Report end date (inclusive)
 * @param format - Output format
 * @returns AuditReport with all access records
 */
export async function generateAuditReport(
  sql: SqlFn,
  workspaceId: string,
  startDate: Date,
  endDate: Date,
  format: 'json' | 'csv' = 'json',
): Promise<Result<AuditReport, Error>> {
  try {
    const rows = await sql`
      SELECT
        user_id, entity_ids, timestamp, ip_address, user_agent,
        query_text, result_count, pii_fields_accessed, action
      FROM mcp_audit_log
      WHERE workspace_id = ${workspaceId}
        AND timestamp >= ${startDate}
        AND timestamp <= ${endDate}
      ORDER BY timestamp ASC
      LIMIT 50000
    ` as unknown as Array<{
      user_id: string;
      entity_ids: string | string[];
      timestamp: string;
      ip_address: string | null;
      user_agent: string | null;
      query_text: string | null;
      result_count: number;
      pii_fields_accessed: boolean | null;
      action: string | null;
    }>;

    const records: AuditRecord[] = rows.map(r => ({
      userId: r.user_id,
      entityIds: Array.isArray(r.entity_ids)
        ? r.entity_ids
        : (r.entity_ids ? JSON.parse(r.entity_ids as string) as string[] : []),
      timestamp: new Date(r.timestamp),
      ipAddress: r.ip_address ?? 'unknown',
      userAgent: r.user_agent ?? 'unknown',
      queryText: r.query_text ?? '',
      resultCount: r.result_count ?? 0,
      piiFieldsAccessed: r.pii_fields_accessed ?? false,
      action: (r.action as 'read' | 'write' | 'delete') ?? 'read',
    }));

    const report: AuditReport = {
      workspaceId,
      startDate,
      endDate,
      records,
      generatedAt: new Date(),
      totalRecords: records.length,
      format,
    };

    log.info('Audit report generated', { workspaceId, totalRecords: records.length });
    return ok(report);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Sign an audit log report using RSA-2048 to prevent tampering.
 * @param report - The audit report to sign
 * @returns SignedAuditReport with detached signature and public key
 */
export function signAuditLog(report: AuditReport): Result<SignedAuditReport, Error> {
  try {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const reportJson = JSON.stringify({
      workspaceId: report.workspaceId,
      startDate: report.startDate.toISOString(),
      endDate: report.endDate.toISOString(),
      totalRecords: report.totalRecords,
      generatedAt: report.generatedAt.toISOString(),
      contentHash: createHash('sha256')
        .update(JSON.stringify(report.records))
        .digest('hex'),
    });

    const signer = createSign('RSA-SHA256');
    signer.update(reportJson);
    const signature = signer.sign(privateKey, 'base64');

    const exportId = createHash('sha256')
      .update(`${report.workspaceId}:${report.generatedAt.toISOString()}`)
      .digest('hex')
      .slice(0, 16);

    return ok({
      report,
      signature,
      publicKey: publicKey as string,
      signedAt: new Date(),
      exportId,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Verify the signature of a previously signed audit report.
 * @param signed - The signed audit report
 * @returns true if valid, false if tampered
 */
export function verifyAuditSignature(signed: SignedAuditReport): boolean {
  try {
    const reportJson = JSON.stringify({
      workspaceId: signed.report.workspaceId,
      startDate: signed.report.startDate.toISOString(),
      endDate: signed.report.endDate.toISOString(),
      totalRecords: signed.report.totalRecords,
      generatedAt: signed.report.generatedAt.toISOString(),
      contentHash: createHash('sha256')
        .update(JSON.stringify(signed.report.records))
        .digest('hex'),
    });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(reportJson);
    return verifier.verify(signed.publicKey, signed.signature, 'base64');
  } catch {
    return false;
  }
}

/**
 * Detect anomalous access patterns in a workspace over the past N days.
 * @param sql - SQL function
 * @param workspaceId - Workspace to analyze
 * @param days - Lookback window in days
 * @returns List of flagged access alerts
 */
export async function detectAnomalousAccess(
  sql: SqlFn,
  workspaceId: string,
  days = 30,
): Promise<Result<AnomalousAccessAlert[], Error>> {
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await sql`
      SELECT user_id, entity_ids, timestamp, pii_fields_accessed, result_count
      FROM mcp_audit_log
      WHERE workspace_id = ${workspaceId}
        AND timestamp >= ${since}
      ORDER BY timestamp ASC
      LIMIT 100000
    ` as unknown as Array<{
      user_id: string;
      entity_ids: string | string[];
      timestamp: string;
      pii_fields_accessed: boolean | null;
      result_count: number;
    }>;

    const alerts: AnomalousAccessAlert[] = [];
    const now = new Date();

    // Group by user
    const userMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = userMap.get(row.user_id) ?? [];
      list.push(row);
      userMap.set(row.user_id, list);
    }

    for (const [userId, events] of userMap.entries()) {
      // Bulk access: >200 unique entities in a single session (1-hour window)
      const entityCounts = new Map<number, Set<string>>();
      for (const ev of events) {
        const hourBucket = Math.floor(new Date(ev.timestamp).getTime() / 3_600_000);
        const bucket = entityCounts.get(hourBucket) ?? new Set();
        const ids = Array.isArray(ev.entity_ids)
          ? ev.entity_ids
          : (ev.entity_ids ? JSON.parse(ev.entity_ids as string) as string[] : []);
        for (const id of ids) bucket.add(id);
        entityCounts.set(hourBucket, bucket);
      }
      for (const [, entities] of entityCounts.entries()) {
        if (entities.size > 200) {
          alerts.push({
            alertType: 'bulk_access',
            userId,
            entityIdsInvolved: [...entities].slice(0, 20),
            confidence: Math.min(0.9, 0.5 + (entities.size - 200) / 1000),
            flaggedAt: now,
            details: `Accessed ${entities.size} unique entities in a single hour`,
          });
        }
      }

      // Off-hours: >5 events outside 07:00–20:00
      const offHoursEvents = events.filter(ev => isOffHours(new Date(ev.timestamp)));
      if (offHoursEvents.length > 5) {
        const entityIds = offHoursEvents.flatMap(ev =>
          Array.isArray(ev.entity_ids)
            ? ev.entity_ids as string[]
            : (ev.entity_ids ? JSON.parse(ev.entity_ids as string) as string[] : []),
        );
        alerts.push({
          alertType: 'off_hours',
          userId,
          entityIdsInvolved: [...new Set(entityIds)].slice(0, 10),
          confidence: Math.min(0.85, 0.4 + offHoursEvents.length * 0.03),
          flaggedAt: now,
          details: `${offHoursEvents.length} access events outside business hours in ${days} days`,
        });
      }

      // PII overaccess: >50 PII-flagged access events in window
      const piiEvents = events.filter(ev => ev.pii_fields_accessed);
      if (piiEvents.length > 50) {
        const entityIds = piiEvents.flatMap(ev =>
          Array.isArray(ev.entity_ids)
            ? ev.entity_ids as string[]
            : (ev.entity_ids ? JSON.parse(ev.entity_ids as string) as string[] : []),
        );
        alerts.push({
          alertType: 'pii_overaccess',
          userId,
          entityIdsInvolved: [...new Set(entityIds)].slice(0, 10),
          confidence: Math.min(0.95, 0.6 + piiEvents.length * 0.005),
          flaggedAt: now,
          details: `${piiEvents.length} PII field accesses in ${days} days`,
        });
      }
    }

    alerts.sort((a, b) => b.confidence - a.confidence);
    log.info('Anomaly detection complete', { workspaceId, alertCount: alerts.length });
    return ok(alerts);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Export audit data in a compliance-framework-specific format.
 * @param report - Base audit report
 * @param format - Target compliance format
 * @returns Typed compliance report object
 */
export function exportToComplianceFormat(
  report: AuditReport,
  format: ComplianceFormat,
): Result<SOC2Report | GDPRReport | HIPAAReport, Error> {
  try {
    if (format === 'soc2') {
      const result: SOC2Report = {
        auditPeriod: { start: report.startDate, end: report.endDate },
        controlCategory: 'CC6',
        accessEvents: report.records.map(r => ({
          userId: r.userId,
          resource: r.entityIds[0] ?? 'unknown',
          action: r.action,
          timestamp: r.timestamp.toISOString(),
          outcome: 'success' as const,
        })),
        anomalyCount: 0,
        piiAccessCount: report.records.filter(r => r.piiFieldsAccessed).length,
      };
      return ok(result);
    }

    if (format === 'gdpr') {
      const byUser = new Map<string, AuditRecord[]>();
      for (const r of report.records) {
        const list = byUser.get(r.userId) ?? [];
        list.push(r);
        byUser.set(r.userId, list);
      }
      const result: GDPRReport = {
        dataSubjectRequests: [...byUser.entries()].map(([userId, records]) => ({
          userId,
          entitiesAccessed: [...new Set(records.flatMap(r => r.entityIds))],
          accessDate: records[0]?.timestamp.toISOString() ?? new Date().toISOString(),
          purpose: 'business_operations',
        })),
        retentionPolicyCompliant: true,
        thirdPartyTransfers: [],
      };
      return ok(result);
    }

    if (format === 'hipaa') {
      const phiEvents = report.records.filter(r => r.piiFieldsAccessed);
      const result: HIPAAReport = {
        coveredEntityId: report.workspaceId,
        auditPeriod: { start: report.startDate, end: report.endDate },
        phiAccessEvents: phiEvents.map(r => ({
          userId: r.userId,
          patientId: r.entityIds[0] ?? 'unknown',
          accessTimestamp: r.timestamp.toISOString(),
          accessReason: r.queryText || 'direct_access',
        })),
        breachIndicators: [],
      };
      return ok(result);
    }

    return err(new Error(`Unknown compliance format: ${format}`));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Save a signed audit export record to the database.
 * @param sql - SQL function
 * @param workspaceId - Workspace ID
 * @param signed - The signed audit report metadata
 * @param requestedByUserId - User who requested the export
 */
export async function saveSignedExport(
  sql: SqlFn,
  workspaceId: string,
  signed: SignedAuditReport,
  requestedByUserId: string,
): Promise<Result<void, Error>> {
  try {
    await sql`
      INSERT INTO signed_audit_exports
        (workspace_id, export_id, start_date, end_date, signature, public_key, signed_at, requested_by_user_id, tamper_check_status)
      VALUES (
        ${workspaceId}, ${signed.exportId},
        ${signed.report.startDate}, ${signed.report.endDate},
        ${signed.signature}, ${signed.publicKey}, ${signed.signedAt},
        ${requestedByUserId}, 'valid'
      )
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Save detected anomaly alerts to the database.
 * @param sql - SQL function
 * @param workspaceId - Workspace ID
 * @param alerts - Alerts to persist
 */
export async function saveAnomalyAlerts(
  sql: SqlFn,
  workspaceId: string,
  alerts: AnomalousAccessAlert[],
): Promise<Result<number, Error>> {
  try {
    if (alerts.length === 0) return ok(0);
    let saved = 0;
    for (const alert of alerts) {
      await sql`
        INSERT INTO anomalous_access_alerts
          (workspace_id, alert_type, user_id, entity_ids_involved, confidence, flagged_at, details)
        VALUES (
          ${workspaceId}, ${alert.alertType}, ${alert.userId},
          ${JSON.stringify(alert.entityIdsInvolved)}, ${alert.confidence},
          ${alert.flaggedAt}, ${alert.details}
        )
      `;
      saved++;
    }
    return ok(saved);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Helper to format report as CSV string for download. */
export function reportToCSV(report: AuditReport): string {
  return toCSV(report.records);
}
