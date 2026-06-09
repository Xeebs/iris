import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/reliability-predictor', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/reliability-predictor')>(
    '@iris/semantic-core/reliability-predictor',
  );
  return { ...actual };
});

import { createReliabilityScoringRoutes } from '../routes/reliability-scoring';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSql(overrides: Record<string, unknown> = {}) {
  return vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const q = strings.join('').toLowerCase();
    for (const [pattern, result] of Object.entries(overrides)) {
      if (q.includes(pattern.toLowerCase())) return Promise.resolve(result);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres')>;
}

function makeApp(sql: ReturnType<typeof import('postgres')>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/connectors', createReliabilityScoringRoutes(sql));
  return app;
}

describe('GET /connectors/:id/reliability', () => {
  it('returns reliability data for connector', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);

    const res = await app.request('/connectors/hubspot/reliability');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('score');
    expect(body.data).toHaveProperty('forecast');
  });

  it('returns 401 without workspace', async () => {
    const sql = makeSql({});
    const app = new Hono();
    app.route('/connectors', createReliabilityScoringRoutes(sql));

    const res = await app.request('/connectors/hubspot/reliability');
    expect(res.status).toBe(401);
  });
});

describe('GET /connectors/:id/alerts', () => {
  it('returns alerts and mitigations', async () => {
    const sql = makeSql({
      'reliability_alerts': [
        { id: 1, alert_type: 'warning', reason: 'Low score', created_at: new Date(), suppressed: false, acknowledged: false },
      ],
    });
    const app = makeApp(sql);

    const res = await app.request('/connectors/hubspot/alerts');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('alerts');
    expect(body.data).toHaveProperty('mitigations');
  });
});

describe('POST /connectors/:id/suppress-alert', () => {
  it('returns 201 on valid suppression', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);

    const res = await app.request('/connectors/hubspot/suppress-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertType: 'warning', suppressedBy: 'user-1', reason: 'FP' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
  });

  it('returns 400 when suppressedBy missing', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);

    const res = await app.request('/connectors/hubspot/suppress-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertType: 'warning' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /connectors/:id/assess', () => {
  it('returns assessment result', async () => {
    const sql = makeSql({});
    const app = makeApp(sql);

    const res = await app.request('/connectors/hubspot/assess', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('alerts');
  });
});
