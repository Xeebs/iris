import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeEntityReconciliationRouter } from '../routes/entity-reconciliation.js';

vi.mock('@iris/semantic-core/entity-reconciler', () => {
  const ok = (v: unknown) => ({ isOk: () => true, isErr: () => false, value: v });
  const er = (m: string) => ({ isOk: () => false, isErr: () => true, error: new Error(m) });

  const MockService = vi.fn().mockImplementation(() => ({
    findMatchCandidates: vi.fn().mockResolvedValue(ok([{ candidateId: 'e2', candidateConnector: 'salesforce', confidence: 0.8, attributeOverlap: 0.7, embeddingDistance: 0.3, reasons: ['80% attribute overlap'] }])),
    suggestReconciliation: vi.fn().mockResolvedValue(ok({ sourceId: 'e1', candidates: [], recommendedAction: 'link', mergeOrder: ['e1', 'e2'] })),
    recordReconciliationDecision: vi.fn().mockResolvedValue(ok({ id: 'rec1', sourceId: 'e1', targetId: 'e2', decision: 'merge', recordedAt: new Date() })),
    scoreMatchConfidenceBetween: vi.fn().mockResolvedValue(ok({ confidence: 0.75, breakdown: { attributeOverlap: 0.8, embeddingProximity: 0.6, fuzzyName: 0.7 } })),
    listPendingReconciliations: vi.fn().mockResolvedValue(ok([{ sourceId: 'e1', candidateId: 'e2', confidence: 0.8 }])),
    _er: er,
  }));

  return { EntityReconciler: MockService };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function buildApp() {
  const app = new Hono();
  app.route('/api/v1', makeEntityReconciliationRouter(makeSql()));
  return app;
}

describe('GET /entities/:entityId/matches', () => {
  it('returns match candidates', async () => {
    const res = await buildApp().request('/api/v1/entities/e1/matches');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { candidateId: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.candidateId).toBe('e2');
  });

  it('returns 404 when entity not found', async () => {
    const { EntityReconciler } = await import('@iris/semantic-core/entity-reconciler');
    vi.mocked(EntityReconciler).mockImplementationOnce(() => ({
      findMatchCandidates: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('Entity e99 not found') }),
      suggestReconciliation: vi.fn(),
      recordReconciliationDecision: vi.fn(),
      scoreMatchConfidenceBetween: vi.fn(),
      listPendingReconciliations: vi.fn(),
    }));
    const res = await buildApp().request('/api/v1/entities/e99/matches');
    expect(res.status).toBe(404);
  });
});

describe('POST /entities/:entityId/suggest-reconciliation', () => {
  it('returns suggestion', async () => {
    const res = await buildApp().request('/api/v1/entities/e1/suggest-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetIds: ['e2', 'e3'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recommendedAction: string } };
    expect(body.data.recommendedAction).toBe('link');
  });

  it('returns 400 for empty targetIds', async () => {
    const res = await buildApp().request('/api/v1/entities/e1/suggest-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetIds: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /entities/:entityId/reconciliation-decision', () => {
  it('records a decision', async () => {
    const res = await buildApp().request('/api/v1/entities/e1/reconciliation-decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'e2', decision: 'merge' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { decision: string } };
    expect(body.data.decision).toBe('merge');
  });

  it('returns 400 for invalid decision', async () => {
    const res = await buildApp().request('/api/v1/entities/e1/reconciliation-decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'e2', decision: 'delete' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /reconciliation/score', () => {
  it('scores confidence between two entities', async () => {
    const res = await buildApp().request('/api/v1/reconciliation/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity1Id: 'e1', entity2Id: 'e2' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { confidence: number } };
    expect(body.data.confidence).toBeCloseTo(0.75);
  });
});

describe('GET /reconciliation/pending', () => {
  it('returns pending reconciliation pairs', async () => {
    const res = await buildApp().request('/api/v1/reconciliation/pending');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});
