import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/compliance-reporter', () => ({
  ComplianceReporter: vi.fn().mockImplementation(() => mockInstance),
}));

import { createComplianceRoutes } from '../routes/compliance.js';
import { ComplianceReporter } from '@iris/semantic-core/compliance-reporter';

const mockInstance = {
  generateReport: vi.fn(),
  createDsr: vi.fn(),
  listDsrs: vi.fn(),
  getAuditLog: vi.fn(),
  getAlerts: vi.fn(),
  acknowledgeAlert: vi.fn(),
};

function makeApp() {
  const sql = vi.fn() as unknown as Parameters<typeof createComplianceRoutes>[0];
  const app = new Hono();
  app.route('/compliance', createComplianceRoutes(sql));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /compliance/report/:framework', () => {
  it('returns 401 without workspace', async () => {
    const app = makeApp();
    const res = await app.request('/compliance/report/gdpr');
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid framework', async () => {
    const app = makeApp();
    const res = await app.request('/compliance/report/fisma', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(400);
  });

  it('returns report for valid framework', async () => {
    const { ok } = await import('neverthrow');
    const report = { framework: 'gdpr', totalEvents: 100, dataRetentionStatus: 'compliant' };
    mockInstance.generateReport.mockResolvedValue(ok(report));
    const app = makeApp();
    const res = await app.request('/compliance/report/gdpr', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: typeof report };
    expect(json.data.framework).toBe('gdpr');
  });

  it('returns 500 on service error', async () => {
    const { err } = await import('neverthrow');
    mockInstance.generateReport.mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp();
    const res = await app.request('/compliance/report/hipaa', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /compliance/dsr', () => {
  it('returns 400 for invalid email', async () => {
    const app = makeApp();
    const res = await app.request('/compliance/dsr', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'content-type': 'application/json' },
      body: JSON.stringify({ requestType: 'access', subjectEmail: 'not-an-email', submittedBy: 'admin' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 on successful DSR creation', async () => {
    const { ok } = await import('neverthrow');
    const dsr = { id: 'dsr-1', requestType: 'deletion', status: 'pending' };
    mockInstance.createDsr.mockResolvedValue(ok(dsr));
    const app = makeApp();
    const res = await app.request('/compliance/dsr', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'content-type': 'application/json' },
      body: JSON.stringify({ requestType: 'deletion', subjectEmail: 'user@example.com', submittedBy: 'admin' }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { data: typeof dsr };
    expect(json.data.requestType).toBe('deletion');
  });
});

describe('GET /compliance/audit-log', () => {
  it('returns audit events', async () => {
    const { ok } = await import('neverthrow');
    const events = [{ id: 'evt-1', eventType: 'access', userId: 'user-1' }];
    mockInstance.getAuditLog.mockResolvedValue(ok(events));
    const app = makeApp();
    const res = await app.request('/compliance/audit-log', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });
});

describe('GET /compliance/alerts', () => {
  it('returns anomaly alerts', async () => {
    const { ok } = await import('neverthrow');
    const alerts = [{ id: 'a-1', alertType: 'bulk_export', severity: 'high' }];
    mockInstance.getAlerts.mockResolvedValue(ok(alerts));
    const app = makeApp();
    const res = await app.request('/compliance/alerts', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });
});

describe('POST /compliance/alerts/:id/acknowledge', () => {
  it('returns 200 on success', async () => {
    const { ok } = await import('neverthrow');
    mockInstance.acknowledgeAlert.mockResolvedValue(ok(undefined));
    const app = makeApp();
    const res = await app.request('/compliance/alerts/alert-1/acknowledge', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'x-user-id': 'admin-1' },
    });
    expect(res.status).toBe(200);
  });
});
