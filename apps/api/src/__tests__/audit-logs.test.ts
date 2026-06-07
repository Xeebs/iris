import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const _mockAuditService = {
  queryLogs: vi.fn(),
  exportLogs: vi.fn(),
  logAction: vi.fn(),
};

vi.mock('@iris/semantic-core/audit-log-service', () => ({
  AuditLogService: vi.fn(() => _mockAuditService),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createAuditLogRoutes } = await import('../routes/audit-logs.js');
  return createAuditLogRoutes;
}

function buildApp(workspaceId: string | null = 'ws-1') {
  const outer = new Hono();
  outer.use('*', async (c, next) => {
    if (workspaceId) c.set('workspaceId', workspaceId);
    await next();
  });
  return outer;
}

function okResult<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value, error: null };
}
function errResult(msg: string) {
  const e = new Error(msg);
  return { isOk: () => false, isErr: () => true, value: undefined, error: e };
}

describe('audit-log routes', () => {
  let createAuditLogRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createAuditLogRoutes = await importRoutes();
  });

  describe('GET /', () => {
    it('returns 200 with paginated audit logs', async () => {
      _mockAuditService.queryLogs.mockResolvedValue(okResult({
        logs: [
          { id: 'l1', action: 'entity_write', actorType: 'user', actorId: 'u1', createdAt: new Date() },
          { id: 'l2', action: 'config_change', actorType: 'api_key', actorId: null, createdAt: new Date() },
        ],
        nextCursor: null,
        hasMore: false,
      }));
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
      expect(body.data).toHaveLength(2);
      expect(body.meta.hasMore).toBe(false);
    });

    it('returns 401 without workspace context', async () => {
      const app = buildApp(null);
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs');
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid action filter', async () => {
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs?action=invalid_action');
      expect(res.status).toBe(400);
    });

    it('returns 500 on service error', async () => {
      _mockAuditService.queryLogs.mockResolvedValue(errResult('db error'));
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs');
      expect(res.status).toBe(500);
    });

    it('passes cursor and limit to service', async () => {
      _mockAuditService.queryLogs.mockResolvedValue(okResult({ logs: [], nextCursor: null, hasMore: false }));
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      await app.request('/audit-logs?cursor=abc&limit=10');
      expect(_mockAuditService.queryLogs).toHaveBeenCalledWith('ws-1', expect.objectContaining({ cursor: 'abc', limit: 10 }));
    });

    it('includes pagination meta in response', async () => {
      _mockAuditService.queryLogs.mockResolvedValue(okResult({
        logs: [{ id: 'l1' }],
        nextCursor: 'next-cursor-val',
        hasMore: true,
      }));
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs');
      const body = await res.json() as { meta: { nextCursor: string; hasMore: boolean } };
      expect(body.meta.nextCursor).toBe('next-cursor-val');
      expect(body.meta.hasMore).toBe(true);
    });
  });

  describe('GET /export', () => {
    it('returns JSON export with correct content-type', async () => {
      _mockAuditService.exportLogs.mockResolvedValue(okResult('[{"id":"l1"}]'));
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs/export?format=json');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('content-disposition')).toContain('.json');
    });

    it('returns CSV export with correct content-type', async () => {
      _mockAuditService.exportLogs.mockResolvedValue(okResult('id,action\nl1,entity_write'));
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs/export?format=csv');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('.csv');
    });

    it('defaults to JSON when format not specified', async () => {
      _mockAuditService.exportLogs.mockResolvedValue(okResult('[]'));
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs/export');
      expect(res.status).toBe(200);
      expect(_mockAuditService.exportLogs).toHaveBeenCalledWith('ws-1', 'json');
    });

    it('returns 401 without workspace', async () => {
      const app = buildApp(null);
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs/export');
      expect(res.status).toBe(401);
    });

    it('returns 500 on export failure', async () => {
      _mockAuditService.exportLogs.mockResolvedValue(errResult('export failed'));
      const app = buildApp();
      app.route('/audit-logs', createAuditLogRoutes({} as never));
      const res = await app.request('/audit-logs/export');
      expect(res.status).toBe(500);
    });
  });
});
