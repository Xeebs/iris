import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createEnrichmentConfigRoutes } from '../routes/enrichment-config.js';
import type postgres from 'postgres';

type SqlMock = ReturnType<typeof vi.fn> & {
  mockResolvedValue: (v: unknown) => void;
};

function makeSql(rows: unknown[] = []): ReturnType<typeof postgres> {
  const fn = vi.fn().mockResolvedValue(rows);
  // Tagged template literal proxy
  return new Proxy(fn as unknown as ReturnType<typeof postgres>, {
    apply: (_target, _thisArg, args) => fn(...args),
  });
}

function makeApp(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  app.route('/enrichments', createEnrichmentConfigRoutes(sql));
  return app;
}

describe('GET /enrichments', () => {
  it('returns list of enrichment sources', async () => {
    const sql = makeSql([
      { source_id: 'company-enricher', name: 'Company Enricher', enabled: true, rate_limit_rps: 10, entity_count: '5', last_enriched_at: null },
    ]);
    const app = makeApp(sql);

    const res = await app.request('/enrichments');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('returns 500 on DB error', async () => {
    const sql = makeSql();
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    const app = makeApp(sql);

    const res = await app.request('/enrichments');
    expect(res.status).toBe(500);
  });
});

describe('GET /enrichments/sources/:sourceId', () => {
  it('returns source config when found', async () => {
    const sql = makeSql([{ source_id: 'company-enricher', name: 'Company Enricher', enabled: true, rate_limit_rps: 10 }]);
    const app = makeApp(sql);

    const res = await app.request('/enrichments/sources/company-enricher');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { source_id: string } };
    expect(body.data.source_id).toBe('company-enricher');
  });

  it('returns 404 when source not found', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request('/enrichments/sources/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /enrichments/configure/:sourceId', () => {
  it('creates or updates source configuration', async () => {
    const app = makeApp(makeSql([]));

    const res = await app.request('/enrichments/configure/company-enricher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Company Enricher', apiKey: 'test-key', enabled: true, rateLimitRps: 10 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { configured: boolean } };
    expect(body.data.configured).toBe(true);
  });

  it('returns 400 on invalid input', async () => {
    const app = makeApp(makeSql([]));

    const res = await app.request('/enrichments/configure/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }), // empty name fails min(1)
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /enrichments/entities/:entityId', () => {
  it('returns 401 when workspace header missing', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request('/enrichments/entities/contact:001');
    expect(res.status).toBe(401);
  });

  it('returns enrichment data for entity', async () => {
    const sql = makeSql([
      { enrichment_source: 'company-enricher', enrichment_data: { industry: 'SaaS' }, confidence_score: '0.9', added_at: new Date(), expires_at: new Date(), source_name: 'Company Enricher' },
    ]);
    const app = makeApp(sql);

    const res = await app.request('/enrichments/entities/contact:001', {
      headers: { 'x-workspace-id': 'ws-123' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('POST /enrichments/refresh/:entityId', () => {
  it('returns 401 without workspace header', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request('/enrichments/refresh/contact:001', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('triggers refresh successfully', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request('/enrichments/refresh/contact:001', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { refreshTriggered: boolean } };
    expect(body.data.refreshTriggered).toBe(true);
  });
});

describe('GET /enrichments/coverage', () => {
  it('returns 401 without workspace header', async () => {
    const app = makeApp(makeSql([]));
    const res = await app.request('/enrichments/coverage');
    expect(res.status).toBe(401);
  });

  it('returns coverage stats', async () => {
    const sql = makeSql([
      { source_id: 'company-enricher', name: 'Company Enricher', enriched_entity_count: 42, avg_confidence: '0.87', last_enriched_at: null },
    ]);
    const app = makeApp(sql);

    const res = await app.request('/enrichments/coverage', {
      headers: { 'x-workspace-id': 'ws-123' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});
