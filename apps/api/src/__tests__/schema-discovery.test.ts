import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSchemaDiscoveryRoutes } from '../routes/schema-discovery.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/schema-discovery', () => ({
  SchemaDiscoveryEngine: vi.fn().mockImplementation(() => ({
    runDiscovery: vi.fn(),
    listSuggestions: vi.fn(),
    confirmSuggestion: vi.fn(),
    generateMappingReport: vi.fn(),
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import { SchemaDiscoveryEngine } from '@iris/semantic-core/schema-discovery';

const CONNECTOR_ID = 'hubspot-prod';

function buildApp() {
  const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createSchemaDiscoveryRoutes>[0];
  const router = createSchemaDiscoveryRoutes(sqlMock);

  const wrapper = new Hono();
  wrapper.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-1');
    await next();
  });
  wrapper.route('/api/v1/connectors', router);
  wrapper.route('/api/v1/connectors', router); // duplicate for /suggestions route

  const instance = (SchemaDiscoveryEngine as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value as Record<string, ReturnType<typeof vi.fn>>;
  return { app: wrapper, engine: instance };
}

describe('POST /api/v1/connectors/:connectorId/discover-schema', () => {
  let app: Hono;
  let engine: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    engine = built.engine;
  });

  it('returns 201 with mapping report on success', async () => {
    engine['runDiscovery'].mockResolvedValueOnce(ok({ connectorId: CONNECTOR_ID, entityTypes: [], relationships: [] }));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/discover-schema`, { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('returns 500 on discovery failure', async () => {
    engine['runDiscovery'].mockResolvedValueOnce(err(new Error('db down')));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/discover-schema`, { method: 'POST' });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/connectors/:connectorId/schema-suggestions', () => {
  let app: Hono;
  let engine: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    engine = built.engine;
  });

  it('returns suggestions list', async () => {
    engine['listSuggestions'].mockResolvedValueOnce(ok({ entityTypes: [{ entityType: 'contact' }], relationships: [] }));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/schema-suggestions`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entityTypes: unknown[] } };
    expect(body.data.entityTypes).toHaveLength(1);
  });

  it('returns 500 on failure', async () => {
    engine['listSuggestions'].mockResolvedValueOnce(err(new Error('fail')));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/schema-suggestions`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/connectors/suggestions/:suggestionId/confirm', () => {
  let app: Hono;
  let engine: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    engine = built.engine;
  });

  it('confirms entity_type suggestion', async () => {
    engine['confirmSuggestion'].mockResolvedValueOnce(ok(undefined));
    const res = await app.request(`/api/v1/connectors/suggestions/s-1/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'entity_type' }),
    });
    expect(res.status).toBe(200);
    expect(engine['confirmSuggestion']).toHaveBeenCalledWith('s-1', 'entity_type_suggestions');
  });

  it('confirms relationship suggestion', async () => {
    engine['confirmSuggestion'].mockResolvedValueOnce(ok(undefined));
    const res = await app.request(`/api/v1/connectors/suggestions/r-1/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'relationship' }),
    });
    expect(res.status).toBe(200);
    expect(engine['confirmSuggestion']).toHaveBeenCalledWith('r-1', 'relationship_suggestions');
  });

  it('returns 400 for invalid type', async () => {
    const res = await app.request(`/api/v1/connectors/suggestions/s-1/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'unknown_type' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 on confirm failure', async () => {
    engine['confirmSuggestion'].mockResolvedValueOnce(err(new Error('not found')));
    const res = await app.request(`/api/v1/connectors/suggestions/s-1/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'entity_type' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/connectors/:connectorId/schema-report', () => {
  let app: Hono;
  let engine: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    engine = built.engine;
  });

  it('returns mapping report', async () => {
    engine['generateMappingReport'].mockResolvedValueOnce(ok({
      connectorId: CONNECTOR_ID,
      coverageScore: 0.9,
      entityTypes: [],
      relationships: [],
      totalEntities: 100,
      generatedAt: new Date(),
    }));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/schema-report`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { coverageScore: number } };
    expect(body.data.coverageScore).toBe(0.9);
  });

  it('returns 500 on failure', async () => {
    engine['generateMappingReport'].mockResolvedValueOnce(err(new Error('fail')));
    const res = await app.request(`/api/v1/connectors/${CONNECTOR_ID}/schema-report`);
    expect(res.status).toBe(500);
  });
});
