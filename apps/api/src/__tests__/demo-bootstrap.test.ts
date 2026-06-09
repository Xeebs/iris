import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const mockCreateKey = vi.fn();

vi.mock('@iris/semantic-core', () => ({
  ApiKeyManager: vi.fn(() => ({ createKey: mockCreateKey })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createDemoBootstrapRoutes } = await import('../routes/demo-bootstrap.js');
  return createDemoBootstrapRoutes;
}

function makeSql(returnValue: unknown[] = [{ id: 'ws-demo-1' }]) {
  return vi.fn().mockResolvedValue(returnValue) as unknown as Parameters<
    Awaited<ReturnType<typeof importRoutes>>
  >[0];
}

function okResult(value: { rawKey: string; id: string }) {
  return { isErr: () => false, value };
}

function errResult(error: Error) {
  return { isErr: () => true, error };
}

describe('demo-bootstrap routes', () => {
  let createDemoBootstrapRoutes: Awaited<ReturnType<typeof importRoutes>>;
  const originalDemoMode = process.env['DEMO_MODE'];

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env['DEMO_MODE'] = 'true';
    mockCreateKey.mockResolvedValue(okResult({ rawKey: 'iris_demo_raw_key', id: 'key-1' }));
    createDemoBootstrapRoutes = await importRoutes();
  });

  afterEach(() => {
    if (originalDemoMode === undefined) {
      delete process.env['DEMO_MODE'];
    } else {
      process.env['DEMO_MODE'] = originalDemoMode;
    }
  });

  function buildApp(sqlMock = makeSql()) {
    const app = new Hono();
    app.route('/demo', createDemoBootstrapRoutes(sqlMock));
    return app;
  }

  function postBootstrap(app: Hono, body?: unknown) {
    return app.request('/demo/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  describe('POST /bootstrap', () => {
    it('creates a workspace and API key, returning 201', async () => {
      const res = await postBootstrap(buildApp(), {});
      expect(res.status).toBe(201);
      const json = (await res.json()) as { data: { workspaceId: string; apiKey: string } };
      expect(json.data.workspaceId).toBe('ws-demo-1');
      expect(json.data.apiKey).toBe('iris_demo_raw_key');
    });

    it('passes the workspace id to ApiKeyManager.createKey', async () => {
      await postBootstrap(buildApp(), { name: 'My Demo' });
      expect(mockCreateKey).toHaveBeenCalledWith('ws-demo-1', 'demo-bootstrap');
    });

    it('defaults the workspace name when body is empty', async () => {
      const sql = makeSql();
      await postBootstrap(buildApp(sql));
      const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
      expect(sqlMock).toHaveBeenCalled();
      const templateValues = sqlMock.mock.calls[0] as unknown[];
      expect(templateValues).toContain('Slice Demo Workspace');
    });

    it('returns 404 when DEMO_MODE is not enabled', async () => {
      process.env['DEMO_MODE'] = 'false';
      const res = await postBootstrap(buildApp(), {});
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 on invalid name', async () => {
      const res = await postBootstrap(buildApp(), { name: '' });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 500 when workspace insert yields no row', async () => {
      const res = await postBootstrap(buildApp(makeSql([])), {});
      expect(res.status).toBe(500);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when API key creation fails', async () => {
      mockCreateKey.mockResolvedValue(errResult(new Error('db down')));
      const res = await postBootstrap(buildApp(), {});
      expect(res.status).toBe(500);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
