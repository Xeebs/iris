import { describe, it, expect, vi } from 'vitest';
import {
  generateAuditReport,
  signAuditLog,
  verifyAuditSignature,
  detectAnomalousAccess,
  exportToComplianceFormat,
  reportToCSV,
  type AuditRecord,
} from '../compliance-auditor.js';

const START = new Date('2026-05-01T00:00:00Z');
const END = new Date('2026-05-31T23:59:59Z');
const WS = 'ws-test';

function makeRow(overrides: Partial<{
  user_id: string;
  entity_ids: string;
  timestamp: string;
  ip_address: string | null;
  user_agent: string | null;
  query_text: string | null;
  result_count: number;
  pii_fields_accessed: boolean | null;
  action: string | null;
}> = {}) {
  return {
    user_id: 'user-1',
    entity_ids: '["ent-1","ent-2"]',
    timestamp: '2026-05-15T10:00:00Z',
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0',
    query_text: 'find contacts',
    result_count: 5,
    pii_fields_accessed: false,
    action: 'read',
    ...overrides,
  };
}

describe('generateAuditReport', () => {
  it('maps DB rows to typed AuditRecord objects', async () => {
    const sql = vi.fn().mockResolvedValue([makeRow()]);
    const result = await generateAuditReport(sql as never, WS, START, END);
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report.totalRecords).toBe(1);
    expect(report.records[0]?.userId).toBe('user-1');
    expect(report.records[0]?.entityIds).toEqual(['ent-1', 'ent-2']);
    expect(report.records[0]?.action).toBe('read');
  });

  it('handles null optional fields with defaults', async () => {
    const sql = vi.fn().mockResolvedValue([
      makeRow({ ip_address: null, user_agent: null, query_text: null, pii_fields_accessed: null, action: null }),
    ]);
    const result = await generateAuditReport(sql as never, WS, START, END);
    expect(result.isOk()).toBe(true);
    const r = result._unsafeUnwrap().records[0]!;
    expect(r.ipAddress).toBe('unknown');
    expect(r.userAgent).toBe('unknown');
    expect(r.queryText).toBe('');
    expect(r.piiFieldsAccessed).toBe(false);
    expect(r.action).toBe('read');
  });

  it('returns empty report when no records match', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await generateAuditReport(sql as never, WS, START, END);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalRecords).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('connection reset'));
    const result = await generateAuditReport(sql as never, WS, START, END);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('connection reset');
  });
});

describe('signAuditLog + verifyAuditSignature', () => {
  function makeReport() {
    return {
      workspaceId: WS,
      startDate: START,
      endDate: END,
      records: [],
      generatedAt: new Date('2026-06-01T00:00:00Z'),
      totalRecords: 0,
      format: 'json' as const,
    };
  }

  it('signs a report and verifies successfully', () => {
    const report = makeReport();
    const signResult = signAuditLog(report);
    expect(signResult.isOk()).toBe(true);
    const signed = signResult._unsafeUnwrap();
    expect(signed.signature).toBeTruthy();
    expect(signed.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(verifyAuditSignature(signed)).toBe(true);
  });

  it('generates a unique exportId per report', () => {
    const r1 = signAuditLog({ ...makeReport(), generatedAt: new Date('2026-06-01T00:00:00Z') });
    const r2 = signAuditLog({ ...makeReport(), generatedAt: new Date('2026-06-01T00:00:01Z') });
    expect(r1._unsafeUnwrap().exportId).not.toBe(r2._unsafeUnwrap().exportId);
  });

  it('fails signature verification when report is tampered', () => {
    const signed = signAuditLog(makeReport())._unsafeUnwrap();
    const tampered = {
      ...signed,
      report: {
        ...signed.report,
        totalRecords: 9999,
      },
    };
    expect(verifyAuditSignature(tampered)).toBe(false);
  });

  it('fails verification with wrong public key', () => {
    const signed1 = signAuditLog(makeReport())._unsafeUnwrap();
    const signed2 = signAuditLog(makeReport())._unsafeUnwrap();
    const crossSigned = { ...signed1, publicKey: signed2.publicKey };
    expect(verifyAuditSignature(crossSigned)).toBe(false);
  });
});

describe('detectAnomalousAccess', () => {
  it('flags bulk access when >200 unique entities accessed in one hour', async () => {
    const entityIds = Array.from({ length: 210 }, (_, i) => `ent-${i}`);
    const hourTs = '2026-05-15T10:30:00Z';
    const rows = entityIds.map(id => makeRow({ entity_ids: JSON.stringify([id]), timestamp: hourTs, user_id: 'bulk-user' }));
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await detectAnomalousAccess(sql as never, WS, 30);
    expect(result.isOk()).toBe(true);
    const alerts = result._unsafeUnwrap();
    expect(alerts.some(a => a.alertType === 'bulk_access' && a.userId === 'bulk-user')).toBe(true);
  });

  it('flags off-hours access when >5 events outside 07:00–20:00 UTC', async () => {
    const offHourTs = '2026-05-15T03:00:00Z';
    const rows = Array.from({ length: 7 }, () => makeRow({ timestamp: offHourTs, user_id: 'night-owl' }));
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await detectAnomalousAccess(sql as never, WS, 30);
    expect(result.isOk()).toBe(true);
    const alerts = result._unsafeUnwrap();
    expect(alerts.some(a => a.alertType === 'off_hours' && a.userId === 'night-owl')).toBe(true);
  });

  it('flags PII overaccess when >50 PII-flagged events', async () => {
    const rows = Array.from({ length: 55 }, () =>
      makeRow({ pii_fields_accessed: true, user_id: 'pii-user' }),
    );
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await detectAnomalousAccess(sql as never, WS, 30);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().some(a => a.alertType === 'pii_overaccess')).toBe(true);
  });

  it('returns no alerts for normal access patterns', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ user_id: 'normal-user', timestamp: `2026-05-15T${10 + i}:00:00Z` }),
    );
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await detectAnomalousAccess(sql as never, WS, 30);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await detectAnomalousAccess(sql as never, WS, 30);
    expect(result.isErr()).toBe(true);
  });
});

describe('exportToComplianceFormat', () => {
  const records: AuditRecord[] = [
    {
      userId: 'user-1',
      entityIds: ['ent-1'],
      timestamp: new Date('2026-05-10T09:00:00Z'),
      ipAddress: '10.0.0.1',
      userAgent: 'Chrome',
      queryText: 'find contacts',
      resultCount: 3,
      piiFieldsAccessed: true,
      action: 'read',
    },
  ];

  const report = {
    workspaceId: WS,
    startDate: START,
    endDate: END,
    records,
    generatedAt: new Date(),
    totalRecords: 1,
    format: 'json' as const,
  };

  it('exports SOC 2 format with access events', () => {
    const result = exportToComplianceFormat(report, 'soc2');
    expect(result.isOk()).toBe(true);
    const soc2 = result._unsafeUnwrap() as ReturnType<typeof exportToComplianceFormat>['_unsafeUnwrap'];
    expect('controlCategory' in soc2).toBe(true);
    expect((soc2 as { accessEvents: unknown[] }).accessEvents).toHaveLength(1);
  });

  it('exports GDPR format grouped by user', () => {
    const result = exportToComplianceFormat(report, 'gdpr');
    expect(result.isOk()).toBe(true);
    const gdpr = result._unsafeUnwrap() as { dataSubjectRequests: Array<{ userId: string }> };
    expect(gdpr.dataSubjectRequests).toHaveLength(1);
    expect(gdpr.dataSubjectRequests[0]?.userId).toBe('user-1');
  });

  it('exports HIPAA format filtering only PII events', () => {
    const result = exportToComplianceFormat(report, 'hipaa');
    expect(result.isOk()).toBe(true);
    const hipaa = result._unsafeUnwrap() as { phiAccessEvents: unknown[] };
    expect(hipaa.phiAccessEvents).toHaveLength(1);
  });

  it('returns err for unknown format', () => {
    const result = exportToComplianceFormat(report, 'unknown' as never);
    expect(result.isErr()).toBe(true);
  });
});

describe('reportToCSV', () => {
  it('produces valid CSV with header and data rows', () => {
    const report = {
      workspaceId: WS,
      startDate: START,
      endDate: END,
      records: [
        {
          userId: 'u1',
          entityIds: ['e1', 'e2'],
          timestamp: new Date('2026-05-10T08:00:00Z'),
          ipAddress: '1.2.3.4',
          userAgent: 'curl',
          queryText: 'query',
          resultCount: 2,
          piiFieldsAccessed: false,
          action: 'read' as const,
        },
      ],
      generatedAt: new Date(),
      totalRecords: 1,
      format: 'csv' as const,
    };
    const csv = reportToCSV(report);
    expect(csv).toContain('user_id,entity_ids');
    expect(csv).toContain('u1');
    expect(csv).toContain('e1|e2');
    expect(csv).toContain('no');
  });

  it('produces only header for empty report', () => {
    const report = {
      workspaceId: WS,
      startDate: START,
      endDate: END,
      records: [],
      generatedAt: new Date(),
      totalRecords: 0,
      format: 'csv' as const,
    };
    const csv = reportToCSV(report);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('user_id');
  });
});
