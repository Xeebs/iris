import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';
import { createCircuitBreakerAdminRoutes } from '../routes/circuit-breaker-admin.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const mockService = {
  getStatus: vi.fn(),
  resetCircuit: vi.fn(),
};

vi.mock('@iris/semantic-core/circuit-breaker', () => ({
  CircuitBreakerService: vi.fn(() => mockService),
}));

type CircuitRow = {
  connector_id: string;
  state: string;
  fail_count: number;
  last_failure_at: string | null;
  opened_at: string | null;
  updated_at: string;
};

const closedStatus = {
  connectorId: 'hubspot',
  state: 'closed' as const,
  failCount: 0,
  successCount: 10,
  lastFailureAt: null,
  openedAt: null,
  halfOpenAt: null,
  updatedAt: new Date().toISOString(),
};

const openStatus = {
  ...closedStatus,
  state: 'open' as const,
  failCount: 7,
  lastFailureAt: new Date().toISOString(),
  openedAt: new Date().toISOString(),
};

const halfOpenStatus = {
  ...closedStatus,
  state: 'half_open' as const,
  failCount: 3,
};

function makeSql(returnVal: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnVal);
}

function makeApp(sql: ReturnType<typeof makeSql>) {
  const app = new Hono();
  app.route('/api/v1/admin/connectors', createCircuitBreakerAdminRoutes(sql as never));
  return app;
}

const circuitRows: CircuitRow[] = [
  { connector_id: 'hubspot', state: 'closed', fail_count: 0, last_failure_at: null, opened_at: null, updated_at: new Date().toISOString() },
  { connector_id: 'salesforce', state: 'open', fail_count: 7, last_failure_at: new Date().toISOString(), opened_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

describe('circuit-breaker-admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/admin/connectors/:connectorId/circuit-status', () => {
    it('returns 200 with closed circuit status', async () => {
      mockService.getStatus.mockResolvedValueOnce(ok(closedStatus));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/hubspot/circuit-status', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof closedStatus };
      expect(body.data.state).toBe('closed');
    });

    it('returns open circuit state correctly', async () => {
      mockService.getStatus.mockResolvedValueOnce(ok(openStatus));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/salesforce/circuit-status', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: typeof openStatus };
      expect(body.data.state).toBe('open');
      expect(body.data.failCount).toBe(7);
    });

    it('returns half_open state correctly', async () => {
      mockService.getStatus.mockResolvedValueOnce(ok(halfOpenStatus));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/slack/circuit-status', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: typeof halfOpenStatus };
      expect(body.data.state).toBe('half_open');
    });

    it('returns 500 when service returns err', async () => {
      mockService.getStatus.mockResolvedValueOnce(err(new Error('DB error')));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/hubspot/circuit-status', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(500);
    });

    it('uses default workspace when x-workspace-id header is missing', async () => {
      mockService.getStatus.mockResolvedValueOnce(ok(closedStatus));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/hubspot/circuit-status');
      expect(res.status).toBe(200);
      expect(mockService.getStatus).toHaveBeenCalledWith('hubspot', 'default');
    });

    it('passes workspace header to service', async () => {
      mockService.getStatus.mockResolvedValueOnce(ok(closedStatus));
      await makeApp(makeSql()).request('/api/v1/admin/connectors/hubspot/circuit-status', {
        headers: { 'x-workspace-id': 'my-workspace' },
      });
      expect(mockService.getStatus).toHaveBeenCalledWith('hubspot', 'my-workspace');
    });

    it('includes connectorId in response data', async () => {
      mockService.getStatus.mockResolvedValueOnce(ok(closedStatus));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/hubspot/circuit-status', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: { connectorId: string } };
      expect(body.data.connectorId).toBe('hubspot');
    });
  });

  describe('POST /api/v1/admin/connectors/:connectorId/circuit-reset', () => {
    it('returns 200 with reset confirmation', async () => {
      mockService.resetCircuit.mockResolvedValueOnce(ok(closedStatus));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/hubspot/circuit-reset', {
        method: 'POST',
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { message: string } };
      expect(body.data.message).toContain('CLOSED');
    });

    it('returns connectorId in reset response', async () => {
      mockService.resetCircuit.mockResolvedValueOnce(ok(closedStatus));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/salesforce/circuit-reset', {
        method: 'POST',
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: { connectorId: string } };
      expect(body.data.connectorId).toBe('salesforce');
    });

    it('returns 500 when reset fails', async () => {
      mockService.resetCircuit.mockResolvedValueOnce(err(new Error('Reset failed')));
      const res = await makeApp(makeSql()).request('/api/v1/admin/connectors/hubspot/circuit-reset', {
        method: 'POST',
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(500);
    });

    it('calls resetCircuit with correct connectorId and workspaceId', async () => {
      mockService.resetCircuit.mockResolvedValueOnce(ok(closedStatus));
      await makeApp(makeSql()).request('/api/v1/admin/connectors/my-connector/circuit-reset', {
        method: 'POST',
        headers: { 'x-workspace-id': 'ws-123' },
      });
      expect(mockService.resetCircuit).toHaveBeenCalledWith('my-connector', 'ws-123');
    });

    it('uses default workspace when header missing', async () => {
      mockService.resetCircuit.mockResolvedValueOnce(ok(closedStatus));
      await makeApp(makeSql()).request('/api/v1/admin/connectors/hubspot/circuit-reset', {
        method: 'POST',
      });
      expect(mockService.resetCircuit).toHaveBeenCalledWith('hubspot', 'default');
    });
  });

  describe('GET /api/v1/admin/connectors/circuit-summary', () => {
    it('returns all circuit states for workspace', async () => {
      const sql = makeSql(circuitRows);
      const res = await makeApp(sql).request('/api/v1/admin/connectors/circuit-summary', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof circuitRows };
      expect(body.data).toHaveLength(2);
    });

    it('returns empty array when no connectors registered', async () => {
      const sql = makeSql([]);
      const res = await makeApp(sql).request('/api/v1/admin/connectors/circuit-summary', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(0);
    });

    it('returns 500 when SQL throws', async () => {
      const sql = vi.fn().mockRejectedValueOnce(new Error('DB error'));
      const res = await makeApp(sql).request('/api/v1/admin/connectors/circuit-summary', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      expect(res.status).toBe(500);
    });

    it('uses default workspace when header missing', async () => {
      const sql = makeSql(circuitRows);
      const res = await makeApp(sql).request('/api/v1/admin/connectors/circuit-summary');
      expect(res.status).toBe(200);
    });

    it('includes fail_count in each row', async () => {
      const sql = makeSql(circuitRows);
      const res = await makeApp(sql).request('/api/v1/admin/connectors/circuit-summary', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: Array<{ fail_count: number }> };
      expect(body.data.some((r) => typeof r.fail_count === 'number')).toBe(true);
    });

    it('returns both open and closed connectors', async () => {
      const sql = makeSql(circuitRows);
      const res = await makeApp(sql).request('/api/v1/admin/connectors/circuit-summary', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: Array<{ state: string }> };
      const states = body.data.map((r) => r.state);
      expect(states).toContain('closed');
      expect(states).toContain('open');
    });

    it('includes connector_id in each row', async () => {
      const sql = makeSql(circuitRows);
      const res = await makeApp(sql).request('/api/v1/admin/connectors/circuit-summary', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: Array<{ connector_id: string }> };
      expect(body.data.every((r) => typeof r.connector_id === 'string')).toBe(true);
    });

    it('returns updated_at field for each row', async () => {
      const sql = makeSql(circuitRows);
      const res = await makeApp(sql).request('/api/v1/admin/connectors/circuit-summary', {
        headers: { 'x-workspace-id': 'ws1' },
      });
      const body = await res.json() as { data: Array<{ updated_at: string }> };
      expect(body.data.every((r) => typeof r.updated_at === 'string')).toBe(true);
    });
  });
});
