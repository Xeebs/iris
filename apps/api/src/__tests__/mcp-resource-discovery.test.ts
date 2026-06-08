import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createMcpResourceDiscoveryRoutes } from '../routes/mcp-resource-discovery.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

function makeApp() {
  const app = new Hono();
  app.route('/api/v1/mcp', createMcpResourceDiscoveryRoutes());
  return app;
}

describe('GET /api/v1/mcp/resources', () => {
  it('returns 200 with resource type list', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    expect(res.status).toBe(200);
  });

  it('returns all 4 resource types', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: unknown[]; totalTypes: number } };
    expect(body.data.totalTypes).toBe(4);
    expect(body.data.resourceTypes).toHaveLength(4);
  });

  it('includes entity resource type', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ type: string }> } };
    const types = body.data.resourceTypes.map((r) => r.type);
    expect(types).toContain('entity');
  });

  it('includes document resource type', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ type: string }> } };
    const types = body.data.resourceTypes.map((r) => r.type);
    expect(types).toContain('document');
  });

  it('includes entity-graph resource type', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ type: string }> } };
    const types = body.data.resourceTypes.map((r) => r.type);
    expect(types).toContain('entity-graph');
  });

  it('includes glossary resource type', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ type: string }> } };
    const types = body.data.resourceTypes.map((r) => r.type);
    expect(types).toContain('glossary');
  });

  it('each resource type has required fields', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as {
      data: { resourceTypes: Array<{ type: string; uriPattern: string; sampleUri: string; description: string; mimeType: string; rateLimit: string }> };
    };
    for (const rt of body.data.resourceTypes) {
      expect(rt.type).toBeTruthy();
      expect(rt.uriPattern).toContain('{workspaceId}');
      expect(rt.sampleUri).toBeTruthy();
      expect(rt.description.length).toBeGreaterThan(10);
      expect(rt.mimeType).toBeTruthy();
      expect(rt.rateLimit).toBeTruthy();
    }
  });

  it('hydrates sample URIs with the workspace ID from header', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources', {
      headers: { 'x-workspace-id': 'ws_test999' },
    });
    const body = await res.json() as { data: { resourceTypes: Array<{ sampleUri: string }> } };
    for (const rt of body.data.resourceTypes) {
      expect(rt.sampleUri).toContain('ws_test999');
    }
  });

  it('uses default workspace placeholder when header is absent', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ sampleUri: string }> } };
    expect(body.data.resourceTypes[0]!.sampleUri).not.toContain('ws_abc123');
  });

  it('includes a top-level note field', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { note: string } };
    expect(body.data.note).toBeTruthy();
    expect(typeof body.data.note).toBe('string');
  });

  it('entity resource has application/json mimeType', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ type: string; mimeType: string }> } };
    const entity = body.data.resourceTypes.find((r) => r.type === 'entity');
    expect(entity!.mimeType).toBe('application/json');
  });

  it('document resource has text/plain mimeType', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ type: string; mimeType: string }> } };
    const doc = body.data.resourceTypes.find((r) => r.type === 'document');
    expect(doc!.mimeType).toBe('text/plain');
  });

  it('graph URI pattern includes depth parameter', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ type: string; uriPattern: string }> } };
    const graph = body.data.resourceTypes.find((r) => r.type === 'entity-graph');
    expect(graph!.uriPattern).toContain('depth');
  });

  it('glossary URI pattern has no entity segment', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    const body = await res.json() as { data: { resourceTypes: Array<{ type: string; uriPattern: string }> } };
    const glossary = body.data.resourceTypes.find((r) => r.type === 'glossary');
    expect(glossary!.uriPattern).toBe('glossary://{workspaceId}');
  });

  it('returns correct JSON content-type header', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/resources');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
