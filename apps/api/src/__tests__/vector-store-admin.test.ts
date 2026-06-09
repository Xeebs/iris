import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createVectorStoreAdminRoutes } from '../routes/vector-store-admin.js';

const defaultHealth = {
  tableName: 'iris_entities',
  rowCount: 5000,
  indexExists: true,
  indexType: 'ivfflat',
  lists: 70,
  fragmentation: 5,
  avgQueryLatencyMs: null,
  recommendations: ['Index configuration looks healthy'],
};

const defaultStrategy = { indexType: 'ivfflat', lists: 70, rationale: 'Mid-range dataset' };

vi.mock('@iris/semantic-core/vector-store-tuner', () => ({
  VectorStoreTuner: class {
    async analyzeIndexHealth() { return defaultHealth; }
    recommendIndexStrategy() { return defaultStrategy; }
    async executeReindexing() { return undefined; }
  },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function makeApp() {
  const app = new Hono();
  app.route('/admin/vector-store', createVectorStoreAdminRoutes(makeSql()));
  return app;
}

// ─── GET /admin/vector-store/health ──────────────────────────────────────────

describe('GET /admin/vector-store/health', () => {
  it('returns 200 with health and recommendedStrategy', async () => {
    const res = await makeApp().request('/admin/vector-store/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { health: unknown; recommendedStrategy: unknown } };
    expect(body.data).toHaveProperty('health');
    expect(body.data).toHaveProperty('recommendedStrategy');
  });

  it('health report includes rowCount', async () => {
    const res = await makeApp().request('/admin/vector-store/health');
    const body = await res.json() as { data: { health: { rowCount: number } } };
    expect(body.data.health.rowCount).toBe(5000);
  });

  it('health report includes indexType', async () => {
    const res = await makeApp().request('/admin/vector-store/health');
    const body = await res.json() as { data: { health: { indexType: string } } };
    expect(body.data.health.indexType).toBe('ivfflat');
  });

  it('health report includes recommendations array', async () => {
    const res = await makeApp().request('/admin/vector-store/health');
    const body = await res.json() as { data: { health: { recommendations: string[] } } };
    expect(Array.isArray(body.data.health.recommendations)).toBe(true);
  });

  it('health report includes fragmentation percentage', async () => {
    const res = await makeApp().request('/admin/vector-store/health');
    const body = await res.json() as { data: { health: { fragmentation: number } } };
    expect(typeof body.data.health.fragmentation).toBe('number');
  });

  it('accepts optional table query param', async () => {
    const res = await makeApp().request('/admin/vector-store/health?table=my_vectors');
    expect(res.status).toBe(200);
  });

  it('accepts optional latencySla query param', async () => {
    const res = await makeApp().request('/admin/vector-store/health?latencySla=10');
    expect(res.status).toBe(200);
  });

  it('returns 500 when analyzeIndexHealth throws', async () => {
    const { VectorStoreTuner } = await import('@iris/semantic-core/vector-store-tuner');
    vi.spyOn(VectorStoreTuner.prototype, 'analyzeIndexHealth').mockRejectedValueOnce(new Error('DB error'));
    const res = await makeApp().request('/admin/vector-store/health');
    expect(res.status).toBe(500);
  });

  it('recommended strategy includes indexType', async () => {
    const res = await makeApp().request('/admin/vector-store/health');
    const body = await res.json() as { data: { recommendedStrategy: { indexType: string } } };
    expect(['ivfflat', 'hnsw']).toContain(body.data.recommendedStrategy.indexType);
  });
});

// ─── POST /admin/vector-store/reindex ────────────────────────────────────────

describe('POST /admin/vector-store/reindex', () => {
  it('returns 200 with completion message', async () => {
    const res = await makeApp().request('/admin/vector-store/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { message: string } };
    expect(body.data.message).toContain('Reindex');
  });

  it('accepts table and lists in request body', async () => {
    const res = await makeApp().request('/admin/vector-store/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'custom_table', lists: 50 }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 500 when executeReindexing throws', async () => {
    const { VectorStoreTuner } = await import('@iris/semantic-core/vector-store-tuner');
    vi.spyOn(VectorStoreTuner.prototype, 'executeReindexing').mockRejectedValueOnce(new Error('reindex fail'));
    const res = await makeApp().request('/admin/vector-store/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
  });

  it('handles missing body gracefully', async () => {
    const res = await makeApp().request('/admin/vector-store/reindex', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
