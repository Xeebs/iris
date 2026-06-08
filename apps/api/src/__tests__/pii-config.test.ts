import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

const mockService = {
  getConfig: vi.fn(),
  upsertConfig: vi.fn(),
  addFieldRule: vi.fn(),
  removeFieldRule: vi.fn(),
};

vi.mock('@iris/semantic-core/pii-masker', () => ({
  PiiConfigService: vi.fn(() => mockService),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createPiiConfigRoutes } = await import('../routes/pii-config.js');
  return createPiiConfigRoutes;
}

const SAMPLE_CONFIG = {
  workspaceId: 'ws-1',
  enableAutoDetection: true,
  defaultStrategy: 'redact',
  fields: [{ fieldName: 'email', strategy: 'hash' }],
};

describe('pii-config routes', () => {
  let createPiiConfigRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createPiiConfigRoutes = await importRoutes();
  });

  function buildApp() {
    const app = new Hono();
    app.route('/pii-config', createPiiConfigRoutes({} as never));
    return app;
  }

  describe('GET /', () => {
    it('returns 200 with config', async () => {
      mockService.getConfig.mockResolvedValue(ok(SAMPLE_CONFIG));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof SAMPLE_CONFIG };
      expect(body.data.enableAutoDetection).toBe(true);
    });

    it('returns 400 when workspaceId missing', async () => {
      const res = await buildApp().request('/pii-config');
      expect(res.status).toBe(400);
    });

    it('returns 500 on service error', async () => {
      mockService.getConfig.mockResolvedValue(err(new Error('db error')));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1');
      expect(res.status).toBe(500);
    });
  });

  describe('PUT /', () => {
    it('upserts config and returns 200', async () => {
      mockService.upsertConfig.mockResolvedValue(ok(SAMPLE_CONFIG));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAutoDetection: true, defaultStrategy: 'redact' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 400 when workspaceId missing', async () => {
      const res = await buildApp().request('/pii-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAutoDetection: true, defaultStrategy: 'redact' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when body invalid (bad strategy)', async () => {
      const res = await buildApp().request('/pii-config?workspaceId=ws-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAutoDetection: true, defaultStrategy: 'unknown' }),
      });
      expect(res.status).toBe(400);
    });
  });
});
