import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createDataQualityEngineRoutes } from '../routes/data-quality-engine-routes.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (a: unknown) => a;
  (fn as Record<string, unknown>).json = (o: unknown) => o;
  return fn;
}

function buildApp(sqlRows: unknown[] = []) {
  const app = new Hono();
  app.route('/quality2', createDataQualityEngineRoutes(makeSql(sqlRows)));
  return app;
}

// ─── GET /quality2/score ──────────────────────────────────────────────────────

describe('GET /quality2/score', () => {
  it('returns 0 when no data', async () => {
    const app = buildApp([]);
    const res = await app.request('/quality2/score?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { overallScore: number } };
    expect(body.data.overallScore).toBe(0);
  });

  it('returns computed score', async () => {
    const app = buildApp([{ workspace_id: 'ws-1', weighted_overall: '72.5' }]);
    const res = await app.request('/quality2/score?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { overallScore: number } };
    expect(body.data.overallScore).toBe(72.5);
  });
});

// ─── GET /quality2/by-type ────────────────────────────────────────────────────

describe('GET /quality2/by-type', () => {
  it('returns empty list when no scores', async () => {
    const app = buildApp([]);
    const res = await app.request('/quality2/by-type?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });

  it('returns formatted type scores', async () => {
    const row = {
      entity_type: 'contact', entity_count: '150',
      avg_completeness: '0.85', avg_freshness: '0.90', avg_accuracy: '0.95',
      avg_overall: '0.89',
    };
    const app = buildApp([row]);
    const res = await app.request('/quality2/by-type?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ entityCount: number; avgOverallScore: number }> };
    expect(body.data[0]!.entityCount).toBe(150);
    expect(body.data[0]!.avgOverallScore).toBe(0.89);
  });
});

// ─── GET /quality2/issues ─────────────────────────────────────────────────────

describe('GET /quality2/issues', () => {
  it('returns empty issues list', async () => {
    const app = buildApp([]);
    const res = await app.request('/quality2/issues?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });

  it('returns issues with severity filter', async () => {
    const issue = {
      issue_id: 'i-1', workspace_id: 'ws-1', issue_type: 'stale', entity_type: 'contact',
      affected_count: 50, severity: 'high', description: 'stale entities', first_detected_at: new Date(),
    };
    const app = buildApp([issue]);
    const res = await app.request('/quality2/issues?workspaceId=ws-1&severity=high');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ issueType: string; severity: string }> };
    expect(body.data[0]!.issueType).toBe('stale');
    expect(body.data[0]!.severity).toBe('high');
  });
});

// ─── POST /quality2/issues/:id/apply-remediation ──────────────────────────────

describe('POST /quality2/issues/:id/apply-remediation', () => {
  it('returns 404 when no pending action', async () => {
    const app = buildApp([]);
    const res = await app.request('/quality2/issues/i-1/apply-remediation', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  it('applies remediation when action exists', async () => {
    const sqlFn = vi.fn()
      .mockResolvedValueOnce([{ action_id: 'a-1', action_type: 'run_dedup' }])
      .mockResolvedValue([]);
    (sqlFn as Record<string, unknown>).array = (a: unknown) => a;
    (sqlFn as Record<string, unknown>).json = (o: unknown) => o;

    const app = new Hono();
    app.route('/quality2', createDataQualityEngineRoutes(sqlFn as never));

    const res = await app.request('/quality2/issues/i-1/apply-remediation', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'ws-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string; actionType: string } };
    expect(body.data.status).toBe('applied');
    expect(body.data.actionType).toBe('run_dedup');
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = buildApp([]);
    const res = await app.request('/quality2/issues/i-1/apply-remediation', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
