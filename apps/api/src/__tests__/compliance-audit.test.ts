import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createComplianceAuditRoutes } from '../routes/compliance-audit.js';
import * as auditor from '@iris/semantic-core/compliance-auditor';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/compliance-auditor');

const mockAuditor = vi.mocked(auditor);

function buildApp() {
  const sql = vi.fn();
  const app = new Hono();
  app.route('/api/v1/compliance', createComplianceAuditRoutes(sql as never));
  return { app, sql };
}

const EXPORT_BODY = {
  workspaceId: 'ws-1',
  startDate: '2026-05-01T00:00:00Z',
  endDate: '2026-05-31T23:59:59Z',
  format: 'json' as const,
  requestedByUserId: 'user-1',
};

const REPORT = {
  workspaceId: 'ws-1',
  startDate: new Date('2026-05-01T00:00:00Z'),
  endDate: new Date('2026-05-31T23:59:59Z'),
  records: [],
  generatedAt: new Date('2026-06-01T00:00:00Z'),
  totalRecords: 0,
  format: 'json' as const,
};

const SIGNED = {
  report: REPORT,
  signature: 'sig-abc',
  publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  signedAt: new Date('2026-06-01T00:00:00Z'),
  exportId: 'exp-abc123',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockAuditor.saveSignedExport.mockResolvedValue(ok(undefined));
});

describe('POST /api/v1/compliance/audit-export', () => {
  it('returns 201 with signed export on success', async () => {
    mockAuditor.generateAuditReport.mockResolvedValue(ok(REPORT));
    mockAuditor.signAuditLog.mockReturnValue(ok(SIGNED));

    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/audit-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(EXPORT_BODY),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: { exportId: string } };
    expect(body.data.exportId).toBe('exp-abc123');
  });

  it('returns 400 when endDate <= startDate', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/audit-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...EXPORT_BODY, startDate: '2026-05-31T00:00:00Z', endDate: '2026-05-01T00:00:00Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when generateAuditReport fails', async () => {
    mockAuditor.generateAuditReport.mockResolvedValue(err(new Error('db failure')));
    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/audit-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(EXPORT_BODY),
    });
    expect(res.status).toBe(500);
  });

  it('returns compliance format when complianceFormat is specified', async () => {
    mockAuditor.generateAuditReport.mockResolvedValue(ok(REPORT));
    mockAuditor.exportToComplianceFormat.mockReturnValue(ok({
      auditPeriod: { start: REPORT.startDate, end: REPORT.endDate },
      controlCategory: 'CC6',
      accessEvents: [],
      anomalyCount: 0,
      piiAccessCount: 0,
    }));
    mockAuditor.signAuditLog.mockReturnValue(ok(SIGNED));

    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/audit-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...EXPORT_BODY, complianceFormat: 'soc2' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { complianceReport: unknown } };
    expect(body.data.complianceReport).toBeDefined();
  });
});

describe('GET /api/v1/compliance/audit-exports', () => {
  it('returns 400 without workspaceId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/audit-exports');
    expect(res.status).toBe(400);
  });

  it('returns list of exports', async () => {
    const { app, sql } = buildApp();
    sql.mockResolvedValue([
      { export_id: 'exp-1', start_date: '2026-05-01', end_date: '2026-05-31', signed_at: '2026-06-01T00:00:00Z', requested_by_user_id: 'user-1', tamper_check_status: 'valid' },
    ]);
    const res = await app.request('/api/v1/compliance/audit-exports?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('GET /api/v1/compliance/anomalies', () => {
  it('returns 400 without workspaceId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/anomalies');
    expect(res.status).toBe(400);
  });

  it('returns anomaly alerts', async () => {
    mockAuditor.detectAnomalousAccess.mockResolvedValue(ok([
      {
        alertType: 'bulk_access',
        userId: 'user-1',
        entityIdsInvolved: ['ent-1'],
        confidence: 0.8,
        flaggedAt: new Date(),
        details: 'test',
      },
    ]));

    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/anomalies?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });

  it('returns 500 on detection failure', async () => {
    mockAuditor.detectAnomalousAccess.mockResolvedValue(err(new Error('timeout')));
    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/anomalies?workspaceId=ws-1');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/compliance/verify-export/:exportId', () => {
  it('returns 400 without workspaceId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v1/compliance/verify-export/exp-abc123');
    expect(res.status).toBe(400);
  });

  it('returns 404 when export not found', async () => {
    const { app, sql } = buildApp();
    sql.mockResolvedValue([]);
    const res = await app.request('/api/v1/compliance/verify-export/exp-xyz?workspaceId=ws-1');
    expect(res.status).toBe(404);
  });

  it('returns verified status for valid export', async () => {
    const { app, sql } = buildApp();
    sql.mockResolvedValue([{ signature: 'sig', public_key: 'pk', signed_at: '2026-06-01T00:00:00Z', tamper_check_status: 'valid' }]);
    const res = await app.request('/api/v1/compliance/verify-export/exp-abc123?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { verified: boolean } };
    expect(body.data.verified).toBe(true);
  });
});
