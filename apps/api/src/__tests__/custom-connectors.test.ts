import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';

vi.mock('@iris/connector-sdk/user-connector-loader', () => ({
  validateConnectorDefinition: vi.fn(),
}));

import { validateConnectorDefinition } from '@iris/connector-sdk/user-connector-loader';
import { createCustomConnectorRoutes } from '../routes/custom-connectors.js';

const mockSqlFn = Object.assign(vi.fn((..._args: unknown[]) => Promise.resolve([])), {
  json: (v: unknown) => v,
});
const mockSql = mockSqlFn as unknown as ReturnType<typeof import('postgres').default>;

function makeApp(workspaceId = 'ws-test') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', workspaceId);
    await next();
  });
  app.route('/', createCustomConnectorRoutes(mockSql));
  return app;
}

const sampleDefinition = {
  manifest: {
    id: 'my-connector',
    name: 'My Connector',
    description: 'Test',
    entityTypes: ['item'],
    configSchema: z.object({ apiKey: z.string() }),
    auth: { type: 'api-key' },
    rateLimits: { requestsPerSecond: 5 },
  },
  createConnector: () => ({
    connect: vi.fn(),
    sync: vi.fn(),
    getSchema: vi.fn(),
    healthCheck: vi.fn(),
  }),
};

describe('custom-connectors routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlFn.mockResolvedValue([]);
  });

  describe('GET /', () => {
    it('returns paginated list of custom connectors', async () => {
      mockSqlFn.mockResolvedValueOnce([
        {
          id: 'cc-1', workspace_id: 'ws-test', name: 'My Connector', description: null,
          version: '1.0.0', status: 'active', manifest: {}, validation_errors: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ]);
      const app = makeApp();

      const res = await app.request('/');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { hasMore: boolean } };
      expect(body.data).toHaveLength(1);
      expect(body.meta.hasMore).toBe(false);
    });

    it('filters by status param', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/?status=active');

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid status', async () => {
      const app = makeApp();
      const res = await app.request('/?status=unknown');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /:id', () => {
    it('returns connector by id', async () => {
      mockSqlFn.mockResolvedValueOnce([
        {
          id: 'cc-1', workspace_id: 'ws-test', name: 'My Connector', description: null,
          version: '1.0.0', status: 'active', manifest: {}, validation_errors: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ]);
      const app = makeApp();

      const res = await app.request('/cc-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string } };
      expect(body.data.id).toBe('cc-1');
    });

    it('returns 404 when not found', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/cc-not-found');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /validate', () => {
    it('returns valid=true for a correct definition', async () => {
      (validateConnectorDefinition as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const app = makeApp();

      const res = await app.request('/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Connector', definition: sampleDefinition }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { valid: boolean; errors: string[] } };
      expect(body.data.valid).toBe(true);
      expect(body.data.errors).toHaveLength(0);
    });

    it('returns valid=false with errors for invalid definition', async () => {
      (validateConnectorDefinition as ReturnType<typeof vi.fn>).mockReturnValue([
        'manifest.id must be a non-empty string',
        'Connector instance must implement method: sync()',
      ]);
      const app = makeApp();

      const res = await app.request('/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad Connector', definition: {} }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { valid: boolean; errors: string[] } };
      expect(body.data.valid).toBe(false);
      expect(body.data.errors).toHaveLength(2);
    });

    it('returns 400 when name is missing', async () => {
      const app = makeApp();

      const res = await app.request('/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: sampleDefinition }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when body is invalid JSON', async () => {
      const app = makeApp();

      const res = await app.request('/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /upload', () => {
    it('returns 201 and connector record on successful install', async () => {
      (validateConnectorDefinition as ReturnType<typeof vi.fn>).mockReturnValue([]);
      mockSqlFn.mockResolvedValueOnce([
        {
          id: 'cc-new', workspace_id: 'ws-test', name: 'My Connector', description: null,
          version: '1.0.0', status: 'active', manifest: sampleDefinition.manifest,
          validation_errors: null, created_at: new Date(), updated_at: new Date(),
        },
      ]);
      const app = makeApp();

      const res = await app.request('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Connector',
          version: '1.0.0',
          definition: sampleDefinition,
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { id: string; status: string } };
      expect(body.data.status).toBe('active');
    });

    it('returns 422 when definition validation fails', async () => {
      (validateConnectorDefinition as ReturnType<typeof vi.fn>).mockReturnValue([
        'Missing or invalid "manifest" export',
      ]);
      const app = makeApp();

      const res = await app.request('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad', definition: {} }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as {
        error: { code: string; details: string[] };
      };
      expect(body.error.code).toBe('CONNECTOR_VALIDATION_FAILED');
      expect(body.error.details).toHaveLength(1);
    });

    it('returns 400 for invalid version format', async () => {
      const app = makeApp();

      const res = await app.request('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Connector', version: 'not-semver', definition: sampleDefinition }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:id', () => {
    it('disables connector and returns updated status', async () => {
      mockSqlFn.mockResolvedValueOnce([{ id: 'cc-1' }]);
      const app = makeApp();

      const res = await app.request('/cc-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('disabled');
    });

    it('returns 404 when connector not in workspace', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/cc-not-mine', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });
});
