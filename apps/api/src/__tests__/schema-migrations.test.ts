import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockManager = {
  registerVersion: vi.fn(),
  compareVersions: vi.fn(),
  listVersions: vi.fn(),
  getVersion: vi.fn(),
  buildMigrationPlan: vi.fn(),
  computeMigrationPlan: vi.fn(),
  applyMigration: vi.fn(),
  getMigrations: vi.fn(),
};

vi.mock('@iris/semantic-core/schema-evolution', () => ({
  SchemaEvolutionManager: vi.fn(() => mockManager),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createSchemaMigrationRoutes } = await import('../routes/schema-migrations.js');
  return createSchemaMigrationRoutes;
}

const SAMPLE_VERSION = {
  connectorId: 'hubspot', version: '2.0.0',
  schema: { entities: [{ type: 'contact', fields: [] }] },
  releasedAt: new Date().toISOString(), breakingChanges: [],
};

describe('schema-migrations routes', () => {
  let createSchemaMigrationRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createSchemaMigrationRoutes = await importRoutes();
  });

  function buildApp() {
    const app = new Hono();
    app.route('/schema-migrations', createSchemaMigrationRoutes({} as never));
    return app;
  }

  function req(method: string, path: string, body?: unknown) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  describe('GET /:connectorId/schema/versions', () => {
    it('returns 200 with schema versions', async () => {
      mockManager.listVersions.mockResolvedValue([SAMPLE_VERSION]);
      const res = await buildApp().fetch(req('GET', '/schema-migrations/hubspot/schema/versions'));
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof SAMPLE_VERSION[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 200 with empty list when no versions', async () => {
      mockManager.listVersions.mockResolvedValue([]);
      const res = await buildApp().fetch(req('GET', '/schema-migrations/hubspot/schema/versions'));
      expect(res.status).toBe(200);
    });
  });

  describe('POST /:connectorId/schema/versions', () => {
    const validSchema = {
      schema: {
        version: '2.0.0',
        entityTypes: [{ name: 'contact', attributes: [{ name: 'email', type: 'string', nullable: false }] }],
      },
    };

    it('registers a new schema version and returns 201', async () => {
      mockManager.registerVersion.mockResolvedValue({ isOk: () => true, isErr: () => false, value: { added: [], removed: [] } });
      const res = await buildApp().fetch(req('POST', '/schema-migrations/hubspot/schema/versions', validSchema));
      expect(res.status).toBe(201);
    });

    it('returns 400 when schema is malformed', async () => {
      const res = await buildApp().fetch(req('POST', '/schema-migrations/hubspot/schema/versions', { schema: { version: '' } }));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /:connectorId/schema/migration-plan', () => {
    it('returns 200 with migration plan', async () => {
      mockManager.buildMigrationPlan.mockResolvedValue({ isOk: () => true, isErr: () => false, value: { steps: [], isCompatible: true } });
      const res = await buildApp().fetch(req('GET', '/schema-migrations/hubspot/schema/migration-plan?from=1.0.0&to=2.0.0'));
      expect(res.status).toBe(200);
    });

    it('returns 400 when from/to params missing', async () => {
      const res = await buildApp().fetch(req('GET', '/schema-migrations/hubspot/schema/migration-plan'));
      expect(res.status).toBe(400);
    });
  });
});
