import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/dedup-reconciliation', () => ({
  DedupReconciliationService: vi.fn().mockImplementation(() => mockSvc),
}));

import { createDedupRoutes } from '../routes/dedup-reconciliation.js';
import { DedupReconciliationService } from '@iris/semantic-core/dedup-reconciliation';

const mockSvc = {
  listCandidates: vi.fn(),
  getMetrics: vi.fn(),
  recordDecision: vi.fn(),
  executeMerge: vi.fn(),
  undoMerge: vi.fn(),
};

function makeApp() {
  const sql = vi.fn() as unknown as Parameters<typeof createDedupRoutes>[0];
  const app = new Hono();
  app.route('/dedup', createDedupRoutes(sql));
  return app;
}

beforeEach(() => vi.clearAllMocks());

const sampleCandidate = {
  id: 'cand-1',
  workspaceId: 'ws-1',
  sourceEntityId: 'hubspot:contact:1',
  candidateDuplicateId: 'salesforce:contact:2',
  similarityScore: 0.87,
  detectedAt: '2026-06-08T00:00:00Z',
  status: 'pending',
  decision: null,
  decidedBy: null,
  decidedAt: null,
};

describe('GET /dedup/candidates', () => {
  it('returns 401 without workspace', async () => {
    const res = await makeApp().request('/dedup/candidates');
    expect(res.status).toBe(401);
  });

  it('returns candidate list', async () => {
    mockSvc.listCandidates.mockResolvedValue({ isErr: () => false, value: [sampleCandidate] });
    const res = await makeApp().request('/dedup/candidates', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });

  it('returns 400 for invalid limit', async () => {
    const res = await makeApp().request('/dedup/candidates?limit=9999', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    mockSvc.listCandidates.mockResolvedValue({ isErr: () => true, error: new Error('DB fail') });
    const res = await makeApp().request('/dedup/candidates', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(500);
  });
});

describe('GET /dedup/metrics', () => {
  it('returns workspace metrics', async () => {
    mockSvc.getMetrics.mockResolvedValue({
      isErr: () => false,
      value: { totalCandidates: 10, pendingReview: 3, merged: 5, keptSeparate: 1, ignored: 1, mergeSuccessRate: 0.71 },
    });
    const res = await makeApp().request('/dedup/metrics', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { totalCandidates: number } };
    expect(json.data.totalCandidates).toBe(10);
  });

  it('returns 401 without workspace', async () => {
    const res = await makeApp().request('/dedup/metrics');
    expect(res.status).toBe(401);
  });
});

describe('POST /dedup/candidates/:sourceId/:dupId/decide', () => {
  it('records a decision', async () => {
    mockSvc.recordDecision.mockResolvedValue({ isErr: () => false, value: { ...sampleCandidate, decision: 'merge', status: 'reviewed' } });
    const res = await makeApp().request('/dedup/candidates/hubspot:contact:1/salesforce:contact:2/decide', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'merge', decidedBy: 'alice' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { decision: string } };
    expect(json.data.decision).toBe('merge');
  });

  it('returns 400 for invalid decision', async () => {
    const res = await makeApp().request('/dedup/candidates/a/b/decide', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when candidate not found', async () => {
    mockSvc.recordDecision.mockResolvedValue({ isErr: () => true, error: new Error('not found') });
    const res = await makeApp().request('/dedup/candidates/a/b/decide', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'ignore', decidedBy: 'alice' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /dedup/merge', () => {
  it('executes a merge', async () => {
    mockSvc.executeMerge.mockResolvedValue({
      isErr: () => false,
      value: { survivingEntityId: 'hubspot:contact:1', mergedEntityId: 'salesforce:contact:2', mergedAt: '2026-06-08T00:00:00Z' },
    });
    const res = await makeApp().request('/dedup/merge', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ survivingEntityId: 'hubspot:contact:1', mergedEntityId: 'salesforce:contact:2', mergedBy: 'alice' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 for missing fields', async () => {
    const res = await makeApp().request('/dedup/merge', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ survivingEntityId: 'a' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /dedup/merge/:sourceId/:dupId/undo', () => {
  it('undoes a merge', async () => {
    mockSvc.undoMerge.mockResolvedValue({ isErr: () => false, value: undefined });
    const res = await makeApp().request('/dedup/merge/hubspot:contact:1/salesforce:contact:2/undo', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when merge expired or not found', async () => {
    mockSvc.undoMerge.mockResolvedValue({ isErr: () => true, error: new Error('window expired') });
    const res = await makeApp().request('/dedup/merge/a/b/undo', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });
});
