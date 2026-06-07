import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import { openApiSpec } from '../openapi.js';

function makeApp() {
  const app = new Hono();
  app.get('/openapi.json', (c) => c.json(openApiSpec));
  app.get('/docs', (c) =>
    c.html(`<!DOCTYPE html><html><head><title>Iris API Docs</title></head><body><div id="swagger-ui"></div></body></html>`),
  );
  return app;
}

describe('OpenAPI spec', () => {
  it('has required OpenAPI 3.0 top-level fields', () => {
    expect(openApiSpec.openapi).toBe('3.0.3');
    expect(openApiSpec.info.title).toBe('Iris API');
    expect(openApiSpec.info.version).toBeTruthy();
    expect(openApiSpec.servers).toHaveLength(1);
  });

  it('defines a bearerAuth security scheme', () => {
    const scheme = openApiSpec.components.securitySchemes.bearerAuth;
    expect(scheme.type).toBe('http');
    expect(scheme.scheme).toBe('bearer');
    expect(scheme.bearerFormat).toBe('JWT');
  });

  it('documents health and ready system routes', () => {
    expect(openApiSpec.paths['/health']).toBeDefined();
    expect(openApiSpec.paths['/ready']).toBeDefined();
    expect(openApiSpec.paths['/health'].get.security).toEqual([]);
  });

  it('documents core connector CRUD routes', () => {
    expect(openApiSpec.paths['/connectors']).toBeDefined();
    expect(openApiSpec.paths['/connectors/{id}']).toBeDefined();
    expect(openApiSpec.paths['/connectors/{id}/sync']).toBeDefined();
    expect(openApiSpec.paths['/connectors/{id}/health']).toBeDefined();
    expect(openApiSpec.paths['/connectors/{id}/health/retry']).toBeDefined();
    expect(openApiSpec.paths['/connectors/{id}/sync-logs']).toBeDefined();
  });

  it('documents analytics, glossary, and workflow routes', () => {
    expect(openApiSpec.paths['/analytics/tokens']).toBeDefined();
    expect(openApiSpec.paths['/analytics/breakdown']).toBeDefined();
    expect(openApiSpec.paths['/glossary']).toBeDefined();
    expect(openApiSpec.paths['/workflow-templates']).toBeDefined();
    expect(openApiSpec.paths['/workflow-templates/{id}']).toBeDefined();
  });

  it('documents export, PII, and benchmarking routes', () => {
    expect(openApiSpec.paths['/export/osi']).toBeDefined();
    expect(openApiSpec.paths['/pii-config']).toBeDefined();
    expect(openApiSpec.paths['/benchmarks/peer-comparison']).toBeDefined();
    expect(openApiSpec.paths['/benchmarks/settings']).toBeDefined();
  });

  it('has reusable workspaceId, cursor, and limit parameters', () => {
    expect(openApiSpec.components.parameters.workspaceId.in).toBe('query');
    expect(openApiSpec.components.parameters.cursor.in).toBe('query');
    expect(openApiSpec.components.parameters.limit.schema.default).toBe(50);
  });

  it('has reusable Error and PaginationMeta schemas', () => {
    expect(openApiSpec.components.schemas.Error).toBeDefined();
    expect(openApiSpec.components.schemas.PaginationMeta).toBeDefined();
    expect(openApiSpec.components.schemas.ConnectorInstance).toBeDefined();
    expect(openApiSpec.components.schemas.SemanticEntity).toBeDefined();
  });

  it('documents at least 15 paths', () => {
    const pathCount = Object.keys(openApiSpec.paths).length;
    expect(pathCount).toBeGreaterThanOrEqual(15);
  });
});

describe('GET /openapi.json', () => {
  it('returns 200 with valid JSON spec', async () => {
    const app = makeApp();
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    const body = await res.json() as { openapi: string; info: { title: string } };
    expect(body.openapi).toBe('3.0.3');
    expect(body.info.title).toBe('Iris API');
  });

  it('returns content-type application/json', async () => {
    const app = makeApp();
    const res = await app.request('/openapi.json');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('GET /docs', () => {
  it('returns 200 with HTML page', async () => {
    const app = makeApp();
    const res = await app.request('/docs');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
    expect(text).toContain('swagger-ui');
  });
});
