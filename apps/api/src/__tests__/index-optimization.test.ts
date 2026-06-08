import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

const mockOptimizer = { analyze: vi.fn() };

vi.mock('@iris/semantic-core/index-optimizer', () => ({
  IndexOptimizer: vi.fn(() => mockOptimizer),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createIndexOptimizationRoutes } = await import('../routes/index-optimization.js');
  return createIndexOptimizationRoutes;
}

const SAMPLE_REPORT = {
  workspaceId: 'ws-1',
  hotEntities: [{ entityId: 'e1', accessCount: 50, entityType: 'contact' }],
  suggestions: [{ type: 'REORDER', reason: 'High access frequency', impactScore: 0.8 }],
  analyzedAt: new Date().toISOString(),
};

describe('index-optimization routes', () => {
  let createRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createRoutes = await importRoutes();
  });

  function buildApp() {
    const app = new Hono();
    app.route('/index', createRoutes({} as never));
    return app;
  }

  it('returns 200 with optimization report', async () => {
    mockOptimizer.analyze.mockResolvedValue(ok(SAMPLE_REPORT));
    const res = await buildApp().request('/index/optimize?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof SAMPLE_REPORT };
    expect(body.data.suggestions).toHaveLength(1);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await buildApp().request('/index/optimize');
    expect(res.status).toBe(400);
  });

  it('passes lookbackDays to optimizer', async () => {
    mockOptimizer.analyze.mockResolvedValue(ok(SAMPLE_REPORT));
    await buildApp().request('/index/optimize?workspaceId=ws-1&lookbackDays=14');
    expect(mockOptimizer.analyze).toHaveBeenCalledWith('ws-1', 14);
  });

  it('returns 500 on service error', async () => {
    mockOptimizer.analyze.mockResolvedValue(err(new Error('analysis failed')));
    const res = await buildApp().request('/index/optimize?workspaceId=ws-1');
    expect(res.status).toBe(500);
  });
});
