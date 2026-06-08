import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

const mockHandler = {
  create: vi.fn(),
  getStatus: vi.fn(),
  listRequests: vi.fn(),
};

vi.mock('@iris/semantic-core/dsr-handler', () => ({
  DataSubjectRequestHandler: vi.fn(() => mockHandler),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createDsrRoutes } = await import('../routes/dsr.js');
  return createDsrRoutes;
}

const SAMPLE_REQUEST = {
  requestId: 'req-1',
  workspaceId: 'ws-1',
  subjectIdentifier: 'user@example.com',
  identifierType: 'email',
  requestType: 'access',
  status: 'pending',
  createdAt: new Date().toISOString(),
};

describe('DSR routes', () => {
  let createDsrRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createDsrRoutes = await importRoutes();
  });

  function buildApp(workspaceId: string | null = 'ws-1') {
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (workspaceId) c.set('workspaceId', workspaceId);
      await next();
    });
    app.route('/dsr', createDsrRoutes({} as never));
    return app;
  }

  describe('POST /request', () => {
    it('creates a DSR and returns 201', async () => {
      mockHandler.create.mockResolvedValue(ok(SAMPLE_REQUEST));
      const res = await buildApp().request('/dsr/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectIdentifier: 'user@example.com', identifierType: 'email', requestType: 'access' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { data: typeof SAMPLE_REQUEST };
      expect(body.data.requestId).toBe('req-1');
    });

    it('returns 401 without workspace', async () => {
      const res = await buildApp(null).request('/dsr/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectIdentifier: 'u@e.com', identifierType: 'email', requestType: 'access' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 with invalid requestType', async () => {
      const res = await buildApp().request('/dsr/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectIdentifier: 'u@e.com', identifierType: 'email', requestType: 'invalid' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is missing', async () => {
      const res = await buildApp().request('/dsr/request', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('returns 500 on service error', async () => {
      mockHandler.create.mockResolvedValue(err(new Error('db error')));
      const res = await buildApp().request('/dsr/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectIdentifier: 'u@e.com', identifierType: 'email', requestType: 'access' }),
      });
      expect(res.status).toBe(500);
    });
  });
});
