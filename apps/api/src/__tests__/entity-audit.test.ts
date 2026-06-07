import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const _mockAuditService = {
  listRecentEvents: vi.fn(),
  getHistory: vi.fn(),
  getFieldHistory: vi.fn(),
  detectAnomalies: vi.fn(),
  trackChange: vi.fn(),
};

vi.mock('@iris/semantic-core/entity-audit-service', () => ({
  EntityAuditService: vi.fn(() => _mockAuditService),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createEntityAuditRoutes } = await import('../routes/entity-audit.js');
  return createEntityAuditRoutes;
}

function buildApp(workspaceId: string | null = 'ws-test') {
  const outer = new Hono();
  outer.use('*', async (c, next) => {
    if (workspaceId) c.set('workspaceId', workspaceId);
    await next();
  });
  return outer;
}

function okResult<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value, _unsafeUnwrap: () => value, _unsafeUnwrapErr: () => null };
}
function errResult(msg: string) {
  const e = new Error(msg);
  return { isOk: () => false, isErr: () => true, value: undefined, error: e, _unsafeUnwrap: () => null, _unsafeUnwrapErr: () => e };
}

describe('entity-audit routes', () => {
  let createEntityAuditRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createEntityAuditRoutes = await importRoutes();
  });

  describe('GET /events', () => {
    it('returns 200 with audit events list', async () => {
      _mockAuditService.listRecentEvents.mockResolvedValue(okResult([
        { id: 'e1', entityId: 'eid', changeType: 'created' },
      ]));
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/events');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 401 without workspaceId', async () => {
      const app = buildApp(null);
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/events');
      expect(res.status).toBe(401);
    });

    it('returns 500 on service error', async () => {
      _mockAuditService.listRecentEvents.mockResolvedValue(errResult('db failure'));
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/events');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /entities/:entityId/history', () => {
    it('returns change history for an entity', async () => {
      _mockAuditService.getHistory.mockResolvedValue(okResult([
        { id: 'h1', changeType: 'updated' }, { id: 'h2', changeType: 'created' },
      ]));
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/entities/eid-1/history');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(2);
    });

    it('passes time range query params', async () => {
      _mockAuditService.getHistory.mockResolvedValue(okResult([]));
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      await app.request('/entity-audit/entities/eid-1/history?from=2026-01-01&to=2026-01-31');
      expect(_mockAuditService.getHistory).toHaveBeenCalledWith(
        'ws-test', 'eid-1', { from: '2026-01-01', to: '2026-01-31' }, 50,
      );
    });
  });

  describe('GET /entities/:entityId/fields/:fieldName', () => {
    it('returns field value timeline', async () => {
      _mockAuditService.getFieldHistory.mockResolvedValue(okResult({
        field: 'stage',
        timeline: [{ timestamp: new Date(), value: 'lead', changedBy: 'connector_sync' }],
      }));
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/entities/eid-1/fields/stage');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { field: string } };
      expect(body.data.field).toBe('stage');
    });
  });

  describe('GET /anomalies', () => {
    it('returns detected anomalies', async () => {
      _mockAuditService.detectAnomalies.mockResolvedValue(okResult([
        { entityId: 'e1', anomalyType: 'rapid_recreation', severity: 'high', details: 'test', detectedAt: new Date() },
      ]));
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/anomalies');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 400 for invalid lookbackDays', async () => {
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/anomalies?lookbackDays=999');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /entities/:entityId/track', () => {
    it('tracks a manual change and returns 201', async () => {
      _mockAuditService.trackChange.mockResolvedValue(okResult({
        id: 'new-event', changeType: 'updated',
      }));
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/entities/eid-1/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'contact',
          changeType: 'updated',
          changedBy: 'manual',
          oldValues: { stage: 'lead' },
          newValues: { stage: 'customer' },
        }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 for invalid body', async () => {
      const app = buildApp();
      app.route('/entity-audit', createEntityAuditRoutes({} as never));
      const res = await app.request('/entity-audit/entities/eid-1/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: true }),
      });
      expect(res.status).toBe(400);
    });
  });
});
