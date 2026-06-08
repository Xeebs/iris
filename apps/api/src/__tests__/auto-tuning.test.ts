import { describe, it, expect, vi } from 'vitest';
import * as ATM from '@iris/semantic-core/auto-tuning-optimizer';
import { createAutoTuningRoutes } from '../routes/auto-tuning.js';

vi.mock('@iris/semantic-core/auto-tuning-optimizer', () => {
  const ATO = vi.fn();
  ATO.prototype.listRecommendations = vi.fn();
  ATO.prototype.generateRecommendations = vi.fn();
  ATO.prototype.activateAbTest = vi.fn();
  ATO.prototype.recordFeedback = vi.fn();
  ATO.prototype.analyzeQueryPatterns = vi.fn();
  ATO.prototype.concludeAbTest = vi.fn();
  return { AutoTuningOptimizer: ATO };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function makeSql() {
  const fn = vi.fn().mockResolvedValue([]);
  (fn as unknown as Record<string, unknown>).array = vi.fn((v: unknown) => v);
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function getAto() {
  const ATOClass = ATM.AutoTuningOptimizer as unknown as { mock: { results: Array<{ value: typeof ATM.AutoTuningOptimizer.prototype }> } };
  return ATOClass.mock.results[0]!.value;
}

function makeApp() {
  return createAutoTuningRoutes(makeSql());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /recommendations', () => {
  it('returns 401 when workspace missing', async () => {
    const app = makeApp();
    const res = await app.request('/recommendations', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('returns recommendations list', async () => {
    const app = makeApp();
    const ato = getAto();
    const { ok } = await import('neverthrow');
    vi.mocked(ato.listRecommendations).mockResolvedValueOnce(ok([{
      id: 'rec-1',
      workspaceId: 'ws-1',
      type: 'enable_full_text' as const,
      title: 'Enable FTS',
      description: 'desc',
      estimatedMonthlySavingsCents: 0,
      estimatedQualityImpactPct: 15,
      status: 'pending' as const,
      abTestId: null,
      createdAt: '2026-06-08T00:00:00Z',
    }]));
    const res = await app.request('/recommendations', {
      method: 'GET',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });

  it('returns 500 on service error', async () => {
    const app = makeApp();
    const ato = getAto();
    const { err } = await import('neverthrow');
    vi.mocked(ato.listRecommendations).mockResolvedValueOnce(err(new Error('DB fail')));
    const res = await app.request('/recommendations', {
      method: 'GET',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /recommendations/generate', () => {
  it('returns 201 with generated recommendations', async () => {
    const app = makeApp();
    const ato = getAto();
    const { ok } = await import('neverthrow');
    vi.mocked(ato.generateRecommendations).mockResolvedValueOnce(ok([]));
    const res = await app.request('/recommendations/generate', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /recommendations/:id/apply-test', () => {
  it('returns 422 when recommendation not found', async () => {
    const app = makeApp();
    const ato = getAto();
    const { err } = await import('neverthrow');
    vi.mocked(ato.activateAbTest).mockResolvedValueOnce(err(new Error('Recommendation not found')));
    const res = await app.request('/recommendations/00000000-0000-0000-0000-000000000000/apply-test', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(422);
  });

  it('returns 400 for invalid recommendation UUID', async () => {
    const app = makeApp();
    const res = await app.request('/recommendations/not-a-uuid/apply-test', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /recommendations/:id/feedback', () => {
  it('records helpful feedback', async () => {
    const app = makeApp();
    const ato = getAto();
    const { ok } = await import('neverthrow');
    vi.mocked(ato.recordFeedback).mockResolvedValueOnce(ok(undefined));
    const res = await app.request('/recommendations/rec-1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ helpful: true }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid body', async () => {
    const app = makeApp();
    const res = await app.request('/recommendations/rec-1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ helpful: 'yes' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /query-patterns', () => {
  it('returns query patterns', async () => {
    const app = makeApp();
    const ato = getAto();
    const { ok } = await import('neverthrow');
    vi.mocked(ato.analyzeQueryPatterns).mockResolvedValueOnce(ok({
      topQueries: [],
      zeroResultQueries: [],
      unusedEntityTypes: [],
      highFrequencyEntityTypes: [],
      avgQueryLatencyMs: 120,
    }));
    const res = await app.request('/query-patterns', {
      method: 'GET',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { avgQueryLatencyMs: number } };
    expect(json.data.avgQueryLatencyMs).toBe(120);
  });
});
