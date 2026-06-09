import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/freshness-tracker', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/freshness-tracker')>(
    '@iris/semantic-core/freshness-tracker',
  );
  return { ...actual };
});

import { createFreshnessTrackingRoutes } from '../routes/freshness-tracking';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSql(overrides: Record<string, unknown> = {}) {
  const fn = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const q = strings.join('').toLowerCase();
    for (const [pattern, result] of Object.entries(overrides)) {
      if (q.includes(pattern.toLowerCase())) return Promise.resolve(result);
    }
    return Promise.resolve([]);
  });
  return fn as unknown as ReturnType<typeof import('postgres')>;
}

function makeApp(sql: ReturnType<typeof import('postgres')>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/freshness', createFreshnessTrackingRoutes(sql));
  return app;
}

describe('GET /freshness/entities/:id', () => {
  it('returns 404 when entity not found', async () => {
    const sql = makeSql({ 'entity_freshness_tracking': [] });
    const app = makeApp(sql);

    const res = await app.request('/freshness/entities/missing');
    expect(res.status).toBe(404);
  });

  it('returns freshness status for known entity', async () => {
    const lastModified = new Date(Date.now() - 300000);
    const sql = makeSql({
      'entity_freshness_tracking': [
        {
          entity_id: 'hubspot:contact:001',
          entity_type: 'contact',
          connector_id: 'hubspot',
          last_modified: lastModified,
          indexed_at: new Date(),
        },
      ],
      'freshness_slas': [],
      'percent_rank': [],
    });
    const app = makeApp(sql);

    const res = await app.request('/freshness/entities/hubspot:contact:001');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('entityId', 'hubspot:contact:001');
    expect(body.data).toHaveProperty('ageSeconds');
  });

  it('returns 401 without workspace context', async () => {
    const sql = makeSql({});
    const app = new Hono();
    app.route('/freshness', createFreshnessTrackingRoutes(sql));

    const res = await app.request('/freshness/entities/any');
    expect(res.status).toBe(401);
  });
});

describe('GET /freshness/metrics/:connectorId', () => {
  it('returns freshness metrics for connector', async () => {
    const sql = makeSql({
      'freshness_events': [{ mean_latency: 5000, event_count: 50 }],
      'percentile_cont': [{ p50: 600, p95: 1200, p99: 3600 }],
      'within_sla': [{ total: 50, within_sla: 48 }],
      'entity_type': [],
    });
    const app = makeApp(sql);

    const res = await app.request('/freshness/metrics/hubspot');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('connectorId', 'hubspot');
    expect(body.data).toHaveProperty('freshnessP50');
  });

  it('validates intervalDays query param', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);

    const res = await app.request('/freshness/metrics/hubspot?intervalDays=abc');
    expect(res.status).toBe(400);
  });
});

describe('GET /freshness/stale', () => {
  it('returns list of stale entities', async () => {
    const sql = makeSql({
      'entity_freshness_tracking': [
        {
          entity_id: 'e1',
          entity_type: 'contact',
          connector_id: 'hubspot',
          last_modified: new Date(Date.now() - 10000 * 1000),
          indexed_at: new Date(),
          age_seconds: 10000,
          sla_seconds: 3600,
        },
      ],
    });
    const app = makeApp(sql);

    const res = await app.request('/freshness/stale');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toHaveProperty('count');
  });
});

describe('GET /freshness/predict/:entityId', () => {
  it('returns 400 when connectorId missing', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);

    const res = await app.request('/freshness/predict/e1');
    expect(res.status).toBe(400);
  });

  it('returns prediction with connectorId provided', async () => {
    const sql = makeSql({
      'freshness_events': [{ created_at: new Date() }],
      'entity_freshness_tracking': [{ entity_type: 'contact', max_age_seconds: null }],
    });
    const app = makeApp(sql);

    const res = await app.request('/freshness/predict/e1?connectorId=hubspot');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('entityId', 'e1');
  });
});

describe('GET /freshness/slas', () => {
  it('returns SLA config for workspace', async () => {
    const sla = { id: 1, connector_id: 'hubspot', entity_type: 'contact', max_age_seconds: 3600, warning_threshold_pct: 80 };
    const sql = makeSql({ 'freshness_slas': [sla] });
    const app = makeApp(sql);

    const res = await app.request('/freshness/slas');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
  });
});

describe('POST /freshness/slas', () => {
  it('returns 201 on valid SLA upsert', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);

    const res = await app.request('/freshness/slas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: 'hubspot', entityType: 'contact', maxAgeSeconds: 3600 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
  });

  it('returns 400 on missing maxAgeSeconds', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);

    const res = await app.request('/freshness/slas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: 'hubspot' }),
    });
    expect(res.status).toBe(400);
  });
});
