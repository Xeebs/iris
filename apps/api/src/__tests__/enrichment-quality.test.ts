import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/enrichment-quality-scorer', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/enrichment-quality-scorer')>(
    '@iris/semantic-core/enrichment-quality-scorer',
  );
  return { ...actual };
});

import { createEnrichmentQualityRoutes } from '../routes/enrichment-quality';

function makeSql(overrides: Record<string, unknown> = {}) {
  return vi.fn((strings: TemplateStringsArray, ..._v: unknown[]) => {
    const q = strings.join('').toLowerCase();
    for (const [k, v] of Object.entries(overrides)) {
      if (q.includes(k.toLowerCase())) return Promise.resolve(v);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres')>;
}

function makeApp(sql: ReturnType<typeof import('postgres')>) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/enrichment', createEnrichmentQualityRoutes(sql));
  return app;
}

describe('GET /enrichment/quality/:connectorId', () => {
  it('returns metrics', async () => {
    const sql = makeSql({
      'enrichment_quality_scores': [
        { entity_type: 'contact', mean_completeness: 80, mean_diversity: 0.7, mean_refresh_lag: 3600, entity_count: 10 },
      ],
    });
    const app = makeApp(sql);
    const res = await app.request('/enrichment/quality/clearbit');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
  });

  it('returns 401 without workspace', async () => {
    const sql = makeSql({});
    const app = new Hono();
    app.route('/enrichment', createEnrichmentQualityRoutes(sql));
    const res = await app.request('/enrichment/quality/clearbit');
    expect(res.status).toBe(401);
  });
});

describe('GET /enrichment/gaps', () => {
  it('returns 400 when entityType missing', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);
    const res = await app.request('/enrichment/gaps?connectorId=clearbit');
    expect(res.status).toBe(400);
  });

  it('returns gaps when params provided', async () => {
    const sql = makeSql({
      'enrichment_gaps': [
        { field_name: 'company_size', null_rate: 0.8, null_count: 80, total_count: 100 },
      ],
    });
    const app = makeApp(sql);
    const res = await app.request('/enrichment/gaps?entityType=contact&connectorId=clearbit');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
  });
});

describe('GET /enrichment/sources/:sourceId/reliability', () => {
  it('returns reliability records', async () => {
    const sql = makeSql({
      'source_reliability_feedback': [
        { entity_type: 'contact', accuracy_rating: 0.9, confidence_avg: 0.8, feedback_count: 5 },
      ],
    });
    const app = makeApp(sql);
    const res = await app.request('/enrichment/sources/clearbit/reliability');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
  });
});

describe('POST /enrichment/sources/feedback', () => {
  it('returns 201 on valid feedback', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);
    const res = await app.request('/enrichment/sources/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'clearbit', entityType: 'contact', accuracyRating: 0.9 }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 when accuracyRating out of range', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);
    const res = await app.request('/enrichment/sources/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'clearbit', entityType: 'contact', accuracyRating: 2 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /enrichment/roi/:connectorId', () => {
  it('returns ROI metrics', async () => {
    const sql = makeSql({ 'enrichment_audit_log': [{ total_tokens: 0, entity_count: 0 }] });
    const app = makeApp(sql);
    const res = await app.request('/enrichment/roi/clearbit');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('connectorId');
  });
});
