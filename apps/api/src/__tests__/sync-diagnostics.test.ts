import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const _mockService = {
  getDiagnostics: vi.fn(),
  analyzeConnectorHealth: vi.fn(),
  recordDiagnostic: vi.fn(),
  resolve: vi.fn(),
  categorizeError: vi.fn(),
  generateRecoveryPlan: vi.fn(),
};

vi.mock('@iris/semantic-core/sync-diagnostics', () => ({
  SyncDiagnosticsService: vi.fn(() => _mockService),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createSyncDiagnosticsRoutes } = await import('../routes/sync-diagnostics.js');
  return createSyncDiagnosticsRoutes;
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
  return { isOk: () => true, isErr: () => false, value, error: null, unwrapOr: () => value };
}
function errResult(msg: string) {
  const e = new Error(msg);
  return { isOk: () => false, isErr: () => true, value: undefined, error: e, unwrapOr: (d: unknown) => d };
}

const SAMPLE_DIAGNOSTIC = {
  id: 'd1',
  syncJobId: 'job-1',
  connectorInstanceId: 'hs-1',
  workspaceId: 'ws-1',
  errorCategory: 'auth_failure',
  errorMessage: 'Unauthorized',
  errorDetails: {},
  recoverySuggestions: [{ action: 'reauthorize', description: 'Re-auth', automated: false }],
  isResolved: false,
  resolvedAt: null,
  createdAt: new Date(),
};

const SAMPLE_HEALTH = {
  connectorInstanceId: 'hs-1',
  errorRate: 0.3,
  dominantCategory: 'auth_failure',
  patterns: ['Repeated auth failures'],
  healthStatus: 'degraded',
};

describe('sync-diagnostics routes', () => {
  let createSyncDiagnosticsRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createSyncDiagnosticsRoutes = await importRoutes();
  });

  describe('GET /:connectorInstanceId', () => {
    it('returns 200 with diagnostics and health', async () => {
      _mockService.getDiagnostics.mockResolvedValue(okResult([SAMPLE_DIAGNOSTIC]));
      _mockService.analyzeConnectorHealth.mockResolvedValue(SAMPLE_HEALTH);
      const app = buildApp();
      app.route('/sync-diagnostics', createSyncDiagnosticsRoutes({} as never));
      const res = await app.request('/sync-diagnostics/hs-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { diagnostics: unknown[]; health: { healthStatus: string } } };
      expect(body.data.diagnostics).toHaveLength(1);
      expect(body.data.health.healthStatus).toBe('degraded');
    });

    it('returns 401 without workspace', async () => {
      const app = buildApp(null);
      app.route('/sync-diagnostics', createSyncDiagnosticsRoutes({} as never));
      const res = await app.request('/sync-diagnostics/hs-1');
      expect(res.status).toBe(401);
    });

    it('returns 500 on service error', async () => {
      _mockService.getDiagnostics.mockResolvedValue(errResult('db failure'));
      _mockService.analyzeConnectorHealth.mockResolvedValue(SAMPLE_HEALTH);
      const app = buildApp();
      app.route('/sync-diagnostics', createSyncDiagnosticsRoutes({} as never));
      const res = await app.request('/sync-diagnostics/hs-1');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /', () => {
    it('records a new diagnostic and returns 201', async () => {
      _mockService.recordDiagnostic.mockResolvedValue(okResult(SAMPLE_DIAGNOSTIC));
      const app = buildApp();
      app.route('/sync-diagnostics', createSyncDiagnosticsRoutes({} as never));
      const res = await app.request('/sync-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncJobId: 'job-1',
          connectorInstanceId: 'hs-1',
          errorMessage: 'Unauthorized: invalid token',
        }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 for invalid body', async () => {
      const app = buildApp();
      app.route('/sync-diagnostics', createSyncDiagnosticsRoutes({} as never));
      const res = await app.request('/sync-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missing: 'fields' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 without workspace', async () => {
      const app = buildApp(null);
      app.route('/sync-diagnostics', createSyncDiagnosticsRoutes({} as never));
      const res = await app.request('/sync-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncJobId: 'j', connectorInstanceId: 'c', errorMessage: 'err' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /:id/resolve', () => {
    it('marks diagnostic as resolved', async () => {
      _mockService.resolve.mockResolvedValue(okResult(undefined));
      const app = buildApp();
      app.route('/sync-diagnostics', createSyncDiagnosticsRoutes({} as never));
      const res = await app.request('/sync-diagnostics/d1/resolve', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { resolved: boolean } };
      expect(body.data.resolved).toBe(true);
    });

    it('returns 500 on resolution failure', async () => {
      _mockService.resolve.mockResolvedValue(errResult('db error'));
      const app = buildApp();
      app.route('/sync-diagnostics', createSyncDiagnosticsRoutes({} as never));
      const res = await app.request('/sync-diagnostics/d1/resolve', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });
});
