import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createCircuitBreakerAdminRoutes } from '../routes/circuit-breaker-admin.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

type CircuitRow = {
  connector_id: string;
  workspace_id: string;
  state: string;
  fail_count: number;
  success_count: number;
  last_failure_at: null;
  opened_at: null;
  half_open_at: null;
  updated_at: string;
};

const closedRow: CircuitRow = {
  connector_id: 'hubspot',
  workspace_id: 'ws1',
  state: 'closed',
  fail_count: 0,
  success_count: 10,
  last_failure_at: null,
  opened_at: null,
  half_open_at: null,
  updated_at: new Date().toISOString(),
};

function makeSql(returnVal: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnVal);
}

function makeApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/api/v1/admin/connectors', createCircuitBreakerAdminRoutes(sql as never));
  return app;
}

describe('GET /api/v1/admin/connectors/:connectorId/circuit-status', () => {
  it('returns 200 with circuit status', async () => {
    const sql = makeSql([closedRow]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/connectors/hubspot/circuit-status', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { state: string; connectorId: string } };
    expect(body.data.state).toBe('closed');
    expect(body.data.connectorId).toBe('hubspot');
  });

  it('returns state field as string', async () => {
    const sql = makeSql([{ ...closedRow, state: 'open', opened_at: new Date().toISOString(), fail_count: 5 }]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/connectors/hubspot/circuit-status', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    const body = await res.json() as { data: { state: string } };
    expect(body.data.state).toBe('open');
  });
});

describe('POST /api/v1/admin/connectors/:connectorId/circuit-reset', () => {
  it('returns 200 on successful reset', async () => {
    const sql = makeSql([closedRow]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/connectors/hubspot/circuit-reset', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { connectorId: string; message: string } };
    expect(body.data.connectorId).toBe('hubspot');
    expect(body.data.message).toContain('CLOSED');
  });
});

describe('GET /api/v1/admin/connectors/circuit-summary', () => {
  it('returns array of circuit states', async () => {
    const sql = makeSql([
      { connector_id: 'hubspot', state: 'closed', fail_count: 0 },
      { connector_id: 'salesforce', state: 'open', fail_count: 7 },
    ]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/connectors/circuit-summary', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it('returns empty array when no connectors registered', async () => {
    const sql = makeSql([]);
    const app = makeApp(sql);
    const res = await app.request('/api/v1/admin/connectors/circuit-summary', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });
});
