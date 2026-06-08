import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMcpResourcesRoutes } from '../routes/mcp-resources.js';

function makeApp(): Hono {
  const app = new Hono();
  app.route('/mcp/resources', createMcpResourcesRoutes());
  return app;
}

describe('GET /mcp/resources', () => {
  it('returns 200 with resource descriptors', async () => {
    const res = await makeApp().request('/mcp/resources?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ name: string }> };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('includes entity, entity-graph, and document resource types', async () => {
    const res = await makeApp().request('/mcp/resources?workspaceId=ws-1');
    const body = await res.json() as { data: Array<{ name: string }> };
    const names = body.data.map((r) => r.name);
    expect(names).toContain('entity');
    expect(names).toContain('entity-graph');
    expect(names).toContain('document');
  });

  it('substitutes workspaceId into example URIs', async () => {
    const res = await makeApp().request('/mcp/resources?workspaceId=my-ws');
    const body = await res.json() as { data: Array<{ examples: string[] }> };
    const allExamples = body.data.flatMap((r) => r.examples);
    expect(allExamples.some((ex) => ex.includes('my-ws'))).toBe(true);
  });

  it('uses placeholder when workspaceId is missing', async () => {
    const res = await makeApp().request('/mcp/resources');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ examples: string[] }> };
    const allExamples = body.data.flatMap((r) => r.examples);
    expect(allExamples.some((ex) => ex.includes('your-workspace-id'))).toBe(true);
  });

  it('each descriptor has uriTemplate, description, and mimeType fields', async () => {
    const res = await makeApp().request('/mcp/resources?workspaceId=ws-1');
    const body = await res.json() as { data: Array<{ uriTemplate: string; description: string; mimeType: string }> };
    for (const r of body.data) {
      expect(r.uriTemplate).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.mimeType).toBeTruthy();
    }
  });
});

describe('GET /mcp/resources/uri', () => {
  it('returns 400 when type is missing', async () => {
    const res = await makeApp().request('/mcp/resources/uri?workspaceId=ws-1&entityId=e:1');
    expect(res.status).toBe(400);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await makeApp().request('/mcp/resources/uri?type=entity&entityId=e:1');
    expect(res.status).toBe(400);
  });

  it('returns 400 when entityId is missing', async () => {
    const res = await makeApp().request('/mcp/resources/uri?type=entity&workspaceId=ws-1');
    expect(res.status).toBe(400);
  });

  it('returns entity:// URI for type=entity', async () => {
    const res = await makeApp().request('/mcp/resources/uri?type=entity&workspaceId=ws-1&entityId=hubspot:contact:1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { uri: string } };
    expect(body.data.uri).toBe('entity://ws-1/hubspot:contact:1');
  });

  it('returns graph:// URI for type=entity-graph', async () => {
    const res = await makeApp().request('/mcp/resources/uri?type=entity-graph&workspaceId=ws-1&entityId=e:1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { uri: string } };
    expect(body.data.uri).toBe('graph://ws-1/e:1');
  });

  it('returns document:// URI for type=document', async () => {
    const res = await makeApp().request('/mcp/resources/uri?type=document&workspaceId=ws-1&entityId=doc:1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { uri: string } };
    expect(body.data.uri).toBe('document://ws-1/doc:1');
  });

  it('returns 400 for unknown type', async () => {
    const res = await makeApp().request('/mcp/resources/uri?type=unknown&workspaceId=ws-1&entityId=e:1');
    expect(res.status).toBe(400);
  });
});
