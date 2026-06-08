import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createEnrichmentConfigRoutes } = await import('../routes/enrichment-config.js');
  return createEnrichmentConfigRoutes;
}

const SAMPLE_SOURCE = {
  source_id: 'src-1', name: 'Clearbit', api_endpoint: 'https://api.clearbit.com',
  enabled: true, rate_limit_rps: 10, created_at: new Date(), updated_at: new Date(),
  entity_count: '50', last_enriched_at: new Date(),
};

describe('enrichment-config routes', () => {
  let createEnrichmentConfigRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createEnrichmentConfigRoutes = await importRoutes();
  });

  function makeSql(returnValue: unknown[] = []) {
    return vi.fn().mockResolvedValue(returnValue) as unknown as Parameters<typeof createEnrichmentConfigRoutes>[0];
  }

  function buildApp(sqlMock: ReturnType<typeof makeSql>) {
    const app = new Hono();
    app.route('/enrichments', createEnrichmentConfigRoutes(sqlMock));
    return app;
  }

  describe('GET /', () => {
    it('returns 200 with enrichment sources', async () => {
      const sql = makeSql([SAMPLE_SOURCE]);
      const res = await buildApp(sql).request('/enrichments');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 200 with empty list', async () => {
      const sql = makeSql([]);
      const res = await buildApp(sql).request('/enrichments');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /sources/:sourceId', () => {
    it('returns 200 with source detail', async () => {
      const sql = makeSql([SAMPLE_SOURCE]);
      const res = await buildApp(sql).request('/enrichments/sources/src-1');
      expect(res.status).toBe(200);
    });

    it('returns 404 when source not found', async () => {
      const sql = makeSql([]);
      const res = await buildApp(sql).request('/enrichments/sources/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /configure/:sourceId', () => {
    it('configures an enrichment source and returns 200', async () => {
      const sql = makeSql([{ ...SAMPLE_SOURCE, rate_limit_rps: 20 }]);
      const res = await buildApp(sql).request('/enrichments/configure/src-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Clearbit', enabled: true }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 400 with invalid body (name too short)', async () => {
      const res = await buildApp(makeSql()).request('/enrichments/configure/src-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
    });
  });
});
