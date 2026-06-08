import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVault = { generateApiKey: vi.fn().mockReturnValue({ plaintext: 'iris_sk_full', prefix: 'iris_sk', suffix: 'abc123', hash: 'hashed' }), rotateApiKey: vi.fn() };
const mockAudit = { logAction: vi.fn().mockResolvedValue(undefined) };

vi.mock('@iris/semantic-core/secret-vault', () => ({
  SecretVault: vi.fn(() => mockVault),
}));

vi.mock('@iris/semantic-core/audit-log-service', () => ({
  AuditLogService: vi.fn(() => mockAudit),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createApiKeyManagementRoutes } = await import('../routes/api-key-management.js');
  return createApiKeyManagementRoutes;
}

function makeSql(returnValue: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnValue) as unknown as Parameters<Awaited<ReturnType<typeof importRoutes>>>[0];
}

const SAMPLE_KEY_ROW = {
  id: 'key-1', name: 'Production Key', key_prefix: 'iris_sk', key_suffix: 'abc123',
  status: 'active', key_version: 1, expires_at: null, rotation_schedule_days: 90,
  rotated_at: null, revoked_at: null, created_at: new Date().toISOString(),
};

describe('api-key-management routes', () => {
  let createApiKeyManagementRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createApiKeyManagementRoutes = await importRoutes();
  });

  function buildApp(sqlMock: ReturnType<typeof makeSql>, workspaceId: string | null = 'ws-1') {
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (workspaceId) c.set('workspaceId', workspaceId);
      await next();
    });
    app.route('/api-keys', createApiKeyManagementRoutes(sqlMock, 'master-secret'));
    return app;
  }

  describe('GET /', () => {
    it('returns 200 with masked API keys', async () => {
      const sql = makeSql([SAMPLE_KEY_ROW]);
      const res = await buildApp(sql).request('/api-keys');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ maskedKey: string }> };
      expect(body.data[0]!.maskedKey).toContain('...');
    });

    it('returns 401 without workspace', async () => {
      const res = await buildApp(makeSql(), null).request('/api-keys');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /', () => {
    it('creates API key and returns 201', async () => {
      const newKeyRow = { ...SAMPLE_KEY_ROW, id: 'key-new' };
      const sql = makeSql([newKeyRow]);
      const res = await buildApp(sql).request('/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Key' }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 when name missing', async () => {
      const res = await buildApp(makeSql()).request('/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 without workspace', async () => {
      const res = await buildApp(makeSql(), null).request('/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Key' }),
      });
      expect(res.status).toBe(401);
    });
  });
});
