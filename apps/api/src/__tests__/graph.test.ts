import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createGraphRoutes } from '../routes/graph.js';

// ─── SQL mock factory ──────────────────────────────────────────────────────────

function makeSqlMock(responses: Record<string, unknown[]> = {}) {
  const defaultEntity = { id: 'e1', type: 'contact', label: 'Alice', source_id: 'hubspot:1' };
  const defaultEdge = {
    id: 'r1',
    entity_id: 'e1',
    related_entity_id: 'e2',
    relationship_type: 'belongs_to',
    confidence_score: 1.0,
  };

  const sql = vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    const query = _strings.join('?');
    if (query.includes('iris_entities') && query.includes('indexed_at')) {
      return Promise.resolve(responses['entities'] ?? [defaultEntity]);
    }
    if (query.includes('entity_relationships') && query.includes('entity_id, related_entity_id')) {
      return Promise.resolve(responses['edges'] ?? [defaultEdge]);
    }
    if (query.includes('entity_relationships') && query.includes('DISTINCT related_entity_id')) {
      return Promise.resolve(responses['neighbors'] ?? []);
    }
    if (query.includes('iris_entities') && query.includes('id = ANY')) {
      return Promise.resolve(responses['entities'] ?? [defaultEntity]);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres').default>;

  return sql;
}

function makeApp(sql: ReturnType<typeof import('postgres').default>): Hono {
  const app = new Hono();
  app.route('/api/v1/graph', createGraphRoutes(sql));
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/graph/query', () => {
  let sql: ReturnType<typeof import('postgres').default>;
  let app: Hono;

  beforeEach(() => {
    sql = makeSqlMock();
    app = makeApp(sql);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await app.request('/api/v1/graph/query');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns nodes and edges for a workspace', async () => {
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { nodes: unknown[]; edges: unknown[] } };
    expect(body.data).toHaveProperty('nodes');
    expect(body.data).toHaveProperty('edges');
    expect(Array.isArray(body.data.nodes)).toBe(true);
    expect(Array.isArray(body.data.edges)).toBe(true);
  });

  it('maps entity rows to GraphNode shape', async () => {
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1');
    const body = await res.json() as { data: { nodes: Array<{ id: string; type: string; label: string; sourceId: string }> } };
    const node = body.data.nodes[0];
    expect(node).toHaveProperty('id', 'e1');
    expect(node).toHaveProperty('type', 'contact');
    expect(node).toHaveProperty('label', 'Alice');
    expect(node).toHaveProperty('sourceId', 'hubspot:1');
  });

  it('maps relationship rows to GraphEdge shape', async () => {
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1');
    const body = await res.json() as { data: { edges: Array<{ source: string; target: string; type: string; confidenceScore: number }> } };
    const edge = body.data.edges[0];
    expect(edge).toHaveProperty('source', 'e1');
    expect(edge).toHaveProperty('target', 'e2');
    expect(edge).toHaveProperty('type', 'belongs_to');
    expect(edge).toHaveProperty('confidenceScore', 1.0);
  });

  it('returns empty edges when no nodes match', async () => {
    sql = makeSqlMock({ entities: [] });
    app = makeApp(sql);
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { nodes: unknown[]; edges: unknown[] } };
    expect(body.data.nodes).toHaveLength(0);
    expect(body.data.edges).toHaveLength(0);
  });

  it('validates depth param — rejects depth=0', async () => {
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1&depth=0');
    expect(res.status).toBe(400);
  });

  it('validates depth param — rejects depth=6', async () => {
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1&depth=6');
    expect(res.status).toBe(400);
  });

  it('validates limit param — rejects limit=501', async () => {
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1&limit=501');
    expect(res.status).toBe(400);
  });

  it('returns 500 on SQL error', async () => {
    const brokenSql = vi.fn(() => Promise.reject(new Error('connection error'))) as unknown as ReturnType<typeof import('postgres').default>;
    app = makeApp(brokenSql);
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1');
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('accepts entityId param for expansion', async () => {
    const expansionSql = makeSqlMock({ neighbors: [], entities: [{ id: 'root', type: 'contact', label: 'Root', source_id: 's1' }] });
    app = makeApp(expansionSql);
    const res = await app.request('/api/v1/graph/query?workspaceId=ws1&entityId=root');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { nodes: unknown[] } };
    expect(body.data.nodes.length).toBeGreaterThanOrEqual(0);
  });
});
