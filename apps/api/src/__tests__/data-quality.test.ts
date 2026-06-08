import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

const mockScorer = {
  getReport: vi.fn(),
};

vi.mock('@iris/semantic-core/data-quality-scorer', () => ({
  DataQualityScorer: vi.fn(() => mockScorer),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createDataQualityRoutes } = await import('../routes/data-quality.js');
  return createDataQualityRoutes;
}

const SAMPLE_REPORT = [
  { entityType: 'contact', totalEntities: 200, completeEntities: 180, completenessScore: 0.9, missingFields: ['phone'] },
];

describe('data-quality routes', () => {
  let createDataQualityRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createDataQualityRoutes = await importRoutes();
  });

  function buildApp(workspaceId: string | null = 'ws-1') {
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (workspaceId) c.set('workspaceId', workspaceId);
      await next();
    });
    app.route('/data-quality', createDataQualityRoutes({} as never));
    return app;
  }

  describe('GET /report', () => {
    it('returns 200 with quality report', async () => {
      mockScorer.getReport.mockResolvedValue(ok(SAMPLE_REPORT));
      const res = await buildApp().request('/data-quality/report');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof SAMPLE_REPORT };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.completenessScore).toBe(0.9);
    });

    it('returns 401 without workspace', async () => {
      const res = await buildApp(null).request('/data-quality/report');
      expect(res.status).toBe(401);
    });

    it('filters by entityType when provided', async () => {
      mockScorer.getReport.mockResolvedValue(ok(SAMPLE_REPORT));
      await buildApp().request('/data-quality/report?entityType=contact');
      expect(mockScorer.getReport).toHaveBeenCalledWith('ws-1', 'contact', 50);
    });

    it('returns 500 on service error', async () => {
      mockScorer.getReport.mockResolvedValue(err(new Error('db error')));
      const res = await buildApp().request('/data-quality/report');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /entities/:entityId', () => {
    it('returns 401 without workspace', async () => {
      const res = await buildApp(null).request('/data-quality/entities/e1');
      expect(res.status).toBe(401);
    });
  });
});
