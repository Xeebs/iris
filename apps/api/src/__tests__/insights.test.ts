import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeInsightsRouter } from '../routes/insights.js';

vi.mock('@iris/semantic-core/insight-generator', () => {
  const { ok } = require('neverthrow');
  const sampleInsight = {
    id: 'ins-1', entityType: 'contact', insightType: 'missing_data',
    title: '5 contacts have missing data', summary: 'Missing email/phone',
    affectedCount: 5, severity: 'warning', valueScore: 60,
    evidence: ['5 contacts with no email or phone'], detectedAt: new Date(),
  };
  const MockInsightGenerator = vi.fn().mockImplementation(() => ({
    listInsights: vi.fn().mockResolvedValue(ok({ insights: [sampleInsight], nextCursor: null })),
    discoverInsights: vi.fn().mockResolvedValue(ok([sampleInsight])),
    saveInsight: vi.fn().mockResolvedValue(ok(sampleInsight)),
    generateInsightReport: vi.fn().mockResolvedValue(ok({
      entityType: 'contact', granularity: 'daily', generatedAt: new Date(),
      totalInsights: 1, criticalCount: 0, warningCount: 1, infoCount: 0,
      highlights: [sampleInsight],
    })),
    submitFeedback: vi.fn().mockResolvedValue(ok(undefined)),
    scheduleInsightGeneration: vi.fn().mockResolvedValue(ok({
      id: 'sched-1', entityTypes: ['contact'], frequency: 'daily',
      recipients: ['user@example.com'], lastRunAt: null, nextRunAt: new Date(),
    })),
    listScheduledReports: vi.fn().mockResolvedValue(ok([])),
  }));
  return { InsightGenerator: MockInsightGenerator };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
}

function makeApp() {
  const app = new Hono();
  app.route('/api/v1/insights', makeInsightsRouter(makeSql()));
  return app;
}

describe('GET /api/v1/insights', () => {
  it('returns paginated insights', async () => {
    const res = await makeApp().request('/api/v1/insights');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('accepts type filter', async () => {
    const res = await makeApp().request('/api/v1/insights?type=missing_data');
    expect(res.status).toBe(200);
  });

  it('accepts severity filter', async () => {
    const res = await makeApp().request('/api/v1/insights?severity=warning');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/insights/discover', () => {
  it('discovers insights and returns 201', async () => {
    const res = await makeApp().request('/api/v1/insights/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityTypes: ['contact'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { discovered: number } };
    expect(body.data.discovered).toBe(1);
  });

  it('returns 400 for missing entityTypes', async () => {
    const res = await makeApp().request('/api/v1/insights/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/insights/scheduled', () => {
  it('returns empty scheduled list', async () => {
    const res = await makeApp().request('/api/v1/insights/scheduled');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('POST /api/v1/insights/scheduled', () => {
  it('creates scheduled report and returns 201', async () => {
    const res = await makeApp().request('/api/v1/insights/scheduled', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityTypes: ['contact'], frequency: 'daily', recipients: ['user@example.com'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe('sched-1');
  });

  it('returns 400 for invalid body', async () => {
    const res = await makeApp().request('/api/v1/insights/scheduled', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityTypes: [], frequency: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/insights/:id/feedback', () => {
  it('records feedback', async () => {
    const res = await makeApp().request('/api/v1/insights/ins-1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wasValuable: true }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for missing wasValuable', async () => {
    const res = await makeApp().request('/api/v1/insights/ins-1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/insights/report/:entityType', () => {
  it('returns insight report', async () => {
    const res = await makeApp().request('/api/v1/insights/report/contact');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entityType: string; totalInsights: number } };
    expect(body.data.entityType).toBe('contact');
    expect(body.data.totalInsights).toBe(1);
  });
});
