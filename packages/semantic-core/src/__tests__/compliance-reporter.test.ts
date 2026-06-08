import { describe, it, expect, vi } from 'vitest';
import { ComplianceReporter } from '../compliance-reporter.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
function makeSql(...responses: unknown[][]): Sql {
  let idx = 0;
  const fn = vi.fn(async () => responses[idx++] ?? []);
  return fn as unknown as Sql;
}

const WS = 'ws-test';
const eventRow = {
  id: 'evt-1', workspace_id: WS, event_type: 'access' as const,
  entity_id: 'deal:1', accessed_fields: ['email'], user_id: 'user-1',
  tool_name: 'query-context', ip_address: '1.2.3.4', occurred_at: '2026-06-08T10:00:00Z',
};

describe('ComplianceReporter.recordEvent', () => {
  it('inserts event and returns mapped row', async () => {
    const svc = new ComplianceReporter(makeSql([eventRow], []));
    const result = await svc.recordEvent({
      workspaceId: WS, eventType: 'access', entityId: 'deal:1',
      accessedFields: ['email'], userId: 'user-1', toolName: 'query-context',
    });
    expect(result.isOk()).toBe(true);
    const val = result._unsafeUnwrap();
    expect(val.eventType).toBe('access');
    expect(val.accessedFields).toContain('email');
  });

  it('returns err when insert returns no row', async () => {
    const svc = new ComplianceReporter(makeSql([], []));
    const result = await svc.recordEvent({
      workspaceId: WS, eventType: 'delete', userId: 'user-1',
    });
    expect(result.isErr()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const svc = new ComplianceReporter(sql as unknown as Sql);
    const result = await svc.recordEvent({ workspaceId: WS, eventType: 'access', userId: 'user-1' });
    expect(result.isErr()).toBe(true);
  });
});

describe('ComplianceReporter.getAuditLog', () => {
  it('returns mapped events', async () => {
    const svc = new ComplianceReporter(makeSql([eventRow]));
    const result = await svc.getAuditLog(WS);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(result._unsafeUnwrap()[0]?.id).toBe('evt-1');
  });

  it('returns empty array when no events', async () => {
    const svc = new ComplianceReporter(makeSql([]));
    const result = await svc.getAuditLog(WS);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db fail'));
    const svc = new ComplianceReporter(sql as unknown as Sql);
    const result = await svc.getAuditLog(WS);
    expect(result.isErr()).toBe(true);
  });
});

describe('ComplianceReporter.generateReport', () => {
  const mockSummary = [{ total_events: '150', unique_users: '5', pii_access_count: '30' }];
  const mockByType = [{ event_type: 'access', count: '100' }, { event_type: 'export', count: '50' }];
  const mockDsrCount = [{ count: '2' }];
  const mockAnomalyCount = [{ count: '3' }];

  it('returns GDPR report with correct aggregates', async () => {
    const svc = new ComplianceReporter(makeSql(mockSummary, mockByType, mockDsrCount, mockAnomalyCount));
    const result = await svc.generateReport(WS, 'gdpr', 30);
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report.framework).toBe('gdpr');
    expect(report.totalEvents).toBe(150);
    expect(report.uniqueUsers).toBe(5);
    expect(report.piiAccessCount).toBe(30);
    expect(report.openDsrCount).toBe(2);
    expect(report.eventsByType['access']).toBe(100);
  });

  it('marks dataRetentionStatus review_needed when HIPAA has open DSRs', async () => {
    const svc = new ComplianceReporter(makeSql(mockSummary, mockByType, [{ count: '5' }], [{ count: '1' }]));
    const result = await svc.generateReport(WS, 'hipaa');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().dataRetentionStatus).toBe('review_needed');
  });

  it('marks compliant when no DSRs and few anomalies', async () => {
    const svc = new ComplianceReporter(makeSql(mockSummary, mockByType, [{ count: '0' }], [{ count: '0' }]));
    const result = await svc.generateReport(WS, 'soc2');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().dataRetentionStatus).toBe('compliant');
  });

  it('marks review_needed when more than 10 anomalies', async () => {
    const svc = new ComplianceReporter(makeSql(mockSummary, mockByType, [{ count: '0' }], [{ count: '15' }]));
    const result = await svc.generateReport(WS, 'ccpa');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().dataRetentionStatus).toBe('review_needed');
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db fail'));
    const svc = new ComplianceReporter(sql as unknown as Sql);
    const result = await svc.generateReport(WS, 'gdpr');
    expect(result.isErr()).toBe(true);
  });
});

describe('ComplianceReporter.createDsr', () => {
  it('creates DSR and returns mapped row', async () => {
    const dsrRow = {
      id: 'dsr-1', workspace_id: WS, request_type: 'deletion' as const,
      subject_email: 'user@example.com', submitted_by: 'admin-1',
      status: 'pending' as const, entity_ids: [], completed_at: null, created_at: '2026-06-08',
    };
    const svc = new ComplianceReporter(makeSql([dsrRow]));
    const result = await svc.createDsr(WS, 'deletion', 'user@example.com', 'admin-1');
    expect(result.isOk()).toBe(true);
    const val = result._unsafeUnwrap();
    expect(val.requestType).toBe('deletion');
    expect(val.subjectEmail).toBe('user@example.com');
    expect(val.status).toBe('pending');
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db fail'));
    const svc = new ComplianceReporter(sql as unknown as Sql);
    const result = await svc.createDsr(WS, 'access', 'test@test.com', 'admin');
    expect(result.isErr()).toBe(true);
  });
});

describe('ComplianceReporter.listDsrs', () => {
  it('returns DSR list', async () => {
    const rows = [{
      id: 'dsr-1', workspace_id: WS, request_type: 'access' as const,
      subject_email: 'a@b.com', submitted_by: 'adm', status: 'pending' as const,
      entity_ids: [], completed_at: null, created_at: '2026-06-08',
    }];
    const svc = new ComplianceReporter(makeSql(rows));
    const result = await svc.listDsrs(WS);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
  });
});

describe('ComplianceReporter.getAlerts', () => {
  it('returns unacknowledged alerts', async () => {
    const rows = [{
      id: 'alert-1', workspace_id: WS, alert_type: 'bulk_export' as const,
      severity: 'high' as const, user_id: 'user-1',
      description: 'Bulk export detected', acknowledged: false, created_at: '2026-06-08',
    }];
    const svc = new ComplianceReporter(makeSql(rows));
    const result = await svc.getAlerts(WS);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()[0]?.alertType).toBe('bulk_export');
    expect(result._unsafeUnwrap()[0]?.severity).toBe('high');
  });
});

describe('ComplianceReporter.acknowledgeAlert', () => {
  it('returns ok on success', async () => {
    const svc = new ComplianceReporter(makeSql([[]]));
    const result = await svc.acknowledgeAlert('alert-1', 'admin-1');
    expect(result.isOk()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const svc = new ComplianceReporter(sql as unknown as Sql);
    const result = await svc.acknowledgeAlert('alert-1', 'admin');
    expect(result.isErr()).toBe(true);
  });
});
