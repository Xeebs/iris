import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

const mockSvc = {
  listConfigurations: vi.fn(),
  getConfiguration: vi.fn(),
  upsertConfiguration: vi.fn(),
  deleteConfiguration: vi.fn(),
  processSamlAssertion: vi.fn(),
  processOidcClaims: vi.fn(),
  getProvisionedUsers: vi.fn(),
};

vi.mock('../auth/enterprise-sso.js', () => ({
  EnterpriseSsoService: vi.fn(() => mockSvc),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createSsoConfigRoutes } = await import('../routes/sso-config.js');
  return createSsoConfigRoutes;
}

const SAMPLE_SSO = {
  workspaceId: 'ws-1', provider: 'saml', providerName: 'Okta', enabled: true,
  metadataUrl: 'https://okta.example.com/metadata',
};

describe('sso-config routes', () => {
  let createSsoConfigRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createSsoConfigRoutes = await importRoutes();
  });

  function buildApp(workspaceId: string | null = 'ws-1') {
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (workspaceId) c.set('workspaceId', workspaceId);
      await next();
    });
    app.route('/sso', createSsoConfigRoutes({} as never));
    return app;
  }

  function withWorkspace(method: string, path: string, body?: unknown) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  describe('GET /', () => {
    it('returns 200 with SSO configs', async () => {
      mockSvc.listConfigurations.mockResolvedValue(ok([SAMPLE_SSO]));
      const res = await buildApp().request('/sso');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof SAMPLE_SSO[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 401 without workspace', async () => {
      const res = await buildApp(null).request('/sso');
      expect(res.status).toBe(401);
    });

    it('returns 500 on service error', async () => {
      mockSvc.listConfigurations.mockResolvedValue(err(new Error('db error')));
      const res = await buildApp().request('/sso');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /:provider', () => {
    it('returns 200 for known provider', async () => {
      mockSvc.getConfiguration.mockResolvedValue(ok(SAMPLE_SSO));
      const res = await buildApp().request('/sso/saml');
      expect(res.status).toBe(200);
    });

    it('returns 400 for unknown provider', async () => {
      const res = await buildApp().request('/sso/unknown-provider');
      expect(res.status).toBe(400);
    });

    it('returns 404 when config not found', async () => {
      mockSvc.getConfiguration.mockResolvedValue(ok(null));
      const res = await buildApp().request('/sso/saml');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /', () => {
    it('upserts SSO config and returns 201', async () => {
      mockSvc.upsertConfiguration.mockResolvedValue(ok(SAMPLE_SSO));
      const res = await buildApp().fetch(withWorkspace('POST', '/sso', { provider: 'saml', providerName: 'Okta', metadataUrl: 'https://okta.example.com/metadata' }));
      expect(res.status).toBe(201);
    });

    it('returns 400 with invalid provider', async () => {
      const res = await buildApp().fetch(withWorkspace('POST', '/sso', { provider: 'invalid', providerName: 'Test' }));
      expect(res.status).toBe(400);
    });

    it('returns 401 without workspace', async () => {
      const app = new Hono();
      app.route('/sso', createSsoConfigRoutes({} as never));
      const res = await app.fetch(new Request('http://localhost/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'saml', providerName: 'Okta' }),
      }));
      expect(res.status).toBe(401);
    });
  });
});
