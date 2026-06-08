import { describe, it, expect } from 'vitest';
import {
  detectAnomalousAccess,
  generateAuditReport,
  signAuditLog,
  verifyAuditSignature,
  exportToComplianceFormat,
} from '../compliance-auditor.js';

/** Build in-memory mock SQL that returns rows from a seeded dataset. */
function buildMockSql(auditRows: Array<{
  user_id: string;
  entity_ids: string;
  timestamp: string;
  ip_address: string;
  user_agent: string;
  query_text: string;
  result_count: number;
  pii_fields_accessed: boolean;
  action: string;
}>) {
  return (strings: TemplateStringsArray): Promise<unknown[]> => {
    const query = strings.join('').trim().toLowerCase();
    if (query.includes('from mcp_audit_log')) {
      return Promise.resolve(auditRows);
    }
    return Promise.resolve([]);
  };
}

function seedAuditRows(count: number, options: {
  bulkUserId?: string;
  offHoursUserId?: string;
  piiUserId?: string;
  anomalyInsertAt?: number;
} = {}) {
  const rows: ReturnType<typeof buildMockSql> extends (s: TemplateStringsArray) => Promise<(infer T)[]> ? T[] : never[] = [];
  const BASE_TS = new Date('2026-05-15T10:00:00Z').getTime();

  for (let i = 0; i < count; i++) {
    const userId = i < 50 ? 'normal-user' : `user-${i % 10}`;
    const ts = new Date(BASE_TS + i * 60_000).toISOString();

    rows.push({
      user_id: userId,
      entity_ids: JSON.stringify([`ent-${i % 500}`]),
      timestamp: ts,
      ip_address: '10.0.0.1',
      user_agent: 'test-agent',
      query_text: 'find contacts',
      result_count: 5,
      pii_fields_accessed: false,
      action: 'read',
    });
  }

  // Seed bulk access anomaly: 210 entities in same hour
  if (options.bulkUserId) {
    const bulkTs = '2026-05-16T14:00:00Z';
    for (let i = 0; i < 210; i++) {
      rows.push({
        user_id: options.bulkUserId,
        entity_ids: JSON.stringify([`bulk-ent-${i}`]),
        timestamp: bulkTs,
        ip_address: '10.0.1.1',
        user_agent: 'scraper',
        query_text: 'export all',
        result_count: 1,
        pii_fields_accessed: false,
        action: 'read',
      });
    }
  }

  // Seed off-hours anomaly: 8 events at 3am
  if (options.offHoursUserId) {
    for (let i = 0; i < 8; i++) {
      rows.push({
        user_id: options.offHoursUserId,
        entity_ids: JSON.stringify([`night-ent-${i}`]),
        timestamp: `2026-05-17T03:${String(i * 5).padStart(2, '0')}:00Z`,
        ip_address: '192.168.0.5',
        user_agent: 'unknown',
        query_text: 'dump data',
        result_count: 100,
        pii_fields_accessed: true,
        action: 'read',
      });
    }
  }

  // Seed PII overaccess: 60 PII events
  if (options.piiUserId) {
    for (let i = 0; i < 60; i++) {
      rows.push({
        user_id: options.piiUserId,
        entity_ids: JSON.stringify([`pii-ent-${i}`]),
        timestamp: `2026-05-18T${String(9 + (i % 8)).padStart(2, '0')}:00:00Z`,
        ip_address: '10.0.2.1',
        user_agent: 'data-tool',
        query_text: 'find emails',
        result_count: 50,
        pii_fields_accessed: true,
        action: 'read',
      });
    }
  }

  return rows as Array<{
    user_id: string;
    entity_ids: string;
    timestamp: string;
    ip_address: string;
    user_agent: string;
    query_text: string;
    result_count: number;
    pii_fields_accessed: boolean;
    action: string;
  }>;
}

describe('ComplianceAuditor integration — 1000-entry corpus with seeded anomalies', () => {
  const rows = seedAuditRows(1000, {
    bulkUserId: 'bulk-attacker',
    offHoursUserId: 'night-owl',
    piiUserId: 'pii-abuser',
  });
  const sql = buildMockSql(rows) as never;
  const workspaceId = 'ws-integration';
  const start = new Date('2026-05-01T00:00:00Z');
  const end = new Date('2026-05-31T23:59:59Z');

  it('generates a full audit report with all 1000+ records', async () => {
    const result = await generateAuditReport(sql, workspaceId, start, end, 'json');
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report.totalRecords).toBeGreaterThanOrEqual(1000);
  });

  it('detects all 3 seeded anomaly types', async () => {
    const result = await detectAnomalousAccess(sql, workspaceId, 30);
    expect(result.isOk()).toBe(true);
    const alerts = result._unsafeUnwrap();

    const hasBulk = alerts.some(a => a.alertType === 'bulk_access' && a.userId === 'bulk-attacker');
    const hasOffHours = alerts.some(a => a.alertType === 'off_hours' && a.userId === 'night-owl');
    const hasPii = alerts.some(a => a.alertType === 'pii_overaccess' && a.userId === 'pii-abuser');

    expect(hasBulk).toBe(true);
    expect(hasOffHours).toBe(true);
    expect(hasPii).toBe(true);
  });

  it('detects >=95% of the 3 synthetic anomaly users (zero false negatives)', async () => {
    const result = await detectAnomalousAccess(sql, workspaceId, 30);
    expect(result.isOk()).toBe(true);
    const alerts = result._unsafeUnwrap();
    const detectedUsers = new Set(alerts.map(a => a.userId));

    const syntheticAnomalies = ['bulk-attacker', 'night-owl', 'pii-abuser'];
    const detected = syntheticAnomalies.filter(u => detectedUsers.has(u)).length;
    const detectionRate = detected / syntheticAnomalies.length;

    expect(detectionRate).toBeGreaterThanOrEqual(0.95);
  });

  it('produces valid signature and passes verification on authentic report', async () => {
    const reportResult = await generateAuditReport(sql, workspaceId, start, end, 'json');
    expect(reportResult.isOk()).toBe(true);

    const signResult = signAuditLog(reportResult._unsafeUnwrap());
    expect(signResult.isOk()).toBe(true);
    const signed = signResult._unsafeUnwrap();

    expect(verifyAuditSignature(signed)).toBe(true);
  });

  it('exports valid SOC 2 report with all access events mapped', async () => {
    const reportResult = await generateAuditReport(sql, workspaceId, start, end, 'json');
    const report = reportResult._unsafeUnwrap();
    const soc2Result = exportToComplianceFormat(report, 'soc2');
    expect(soc2Result.isOk()).toBe(true);
    const soc2 = soc2Result._unsafeUnwrap() as { accessEvents: unknown[] };
    expect(soc2.accessEvents).toHaveLength(report.totalRecords);
  });

  it('GDPR report groups each unique user as a data subject request', async () => {
    const reportResult = await generateAuditReport(sql, workspaceId, start, end, 'json');
    const report = reportResult._unsafeUnwrap();
    const gdprResult = exportToComplianceFormat(report, 'gdpr');
    expect(gdprResult.isOk()).toBe(true);
    const gdpr = gdprResult._unsafeUnwrap() as { dataSubjectRequests: Array<{ userId: string }> };
    const uniqueUsers = new Set(report.records.map(r => r.userId));
    expect(gdpr.dataSubjectRequests).toHaveLength(uniqueUsers.size);
  });
});
