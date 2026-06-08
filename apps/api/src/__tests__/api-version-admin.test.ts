import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeApiVersionAdminRouter } from '../routes/api-version-admin.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/api-versioning', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/api-versioning')>('@iris/semantic-core/api-versioning');
  return { ...actual };
});

function makeApp(sqlMock: unknown) {
  return makeApiVersionAdminRouter(sqlMock as ReturnType<typeof import('postgres').default>);
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'content-type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('GET /api-versions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version list', async () => {
    const sql = vi.fn().mockResolvedValue([{ version: 'v1', status: 'deprecated', released_at: new Date(), sunset_at: null, features: ['entities'], min_client_ver: null }]);
    const app = makeApp(sql);
    const res = await app.fetch(req('/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].version).toBe('v1');
  });

  it('returns 500 on db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const app = makeApp(sql);
    const res = await app.fetch(req('/'));
    expect(res.status).toBe(500);
  });
});

describe('POST /api-versions', () => {
  it('registers a new version', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const app = makeApp(sql);
    const res = await app.fetch(req('/', {
      method: 'POST',
      body: JSON.stringify({ version: 'v3', status: 'active', features: ['entities'] }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.version).toBe('v3');
  });

  it('returns 400 for invalid version format', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const app = makeApp(sql);
    const res = await app.fetch(req('/', {
      method: 'POST',
      body: JSON.stringify({ version: 'invalid', status: 'active' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api-versions/:version/deprecated', () => {
  it('returns deprecated endpoints for a version', async () => {
    const sql = vi.fn().mockResolvedValue([
      { path: '/api/v1/old', method: 'GET', version: 'v1', status: 'deprecated', deprecated_at: new Date(), sunset_at: null, migration_path: '/api/v2/new' },
    ]);
    const app = makeApp(sql);
    const res = await app.fetch(req('/v1/deprecated'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].migrationPath).toBe('/api/v2/new');
  });
});

describe('POST /api-versions/endpoints', () => {
  it('registers an endpoint version', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const app = makeApp(sql);
    const res = await app.fetch(req('/endpoints', {
      method: 'POST',
      body: JSON.stringify({ path: '/api/v1/entities', method: 'GET', version: 'v1', status: 'deprecated', migrationPath: '/api/v2/entities' }),
    }));
    expect(res.status).toBe(201);
  });
});
