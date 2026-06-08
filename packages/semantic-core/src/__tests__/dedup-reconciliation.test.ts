import { describe, it, expect, vi } from 'vitest';
import { DedupReconciliationService } from '../dedup-reconciliation.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSql(...responses: unknown[][]) {
  let idx = 0;
  const fn = vi.fn().mockImplementation(() => Promise.resolve(responses[idx++] ?? []));
  return fn as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>;
}

const candidateRow = {
  id: 'cand-1',
  workspace_id: 'ws-1',
  source_entity_id: 'e1',
  candidate_duplicate_id: 'e2',
  similarity_score: '0.91',
  detected_at: '2026-06-08T00:00:00Z',
  status: 'pending' as const,
  decision: null,
  decided_by: null,
  decided_at: null,
};

// ─── upsertCandidate ──────────────────────────────────────────────────────────

describe('DedupReconciliationService.upsertCandidate', () => {
  it('returns inserted candidate', async () => {
    const svc = new DedupReconciliationService(makeSql([candidateRow]));
    const result = await svc.upsertCandidate('ws-1', 'e1', 'e2', 0.91);
    expect(result.isOk()).toBe(true);
    const c = result._unsafeUnwrap();
    expect(c.id).toBe('cand-1');
    expect(c.similarityScore).toBeCloseTo(0.91);
    expect(c.status).toBe('pending');
  });

  it('returns err when insert returns no row', async () => {
    const svc = new DedupReconciliationService(makeSql([]));
    const result = await svc.upsertCandidate('ws-1', 'e1', 'e2', 0.91);
    expect(result.isErr()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('constraint'));
    const svc = new DedupReconciliationService(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.upsertCandidate('ws-1', 'e1', 'e2', 0.91);
    expect(result.isErr()).toBe(true);
  });
});

// ─── listCandidates ───────────────────────────────────────────────────────────

describe('DedupReconciliationService.listCandidates', () => {
  it('returns candidates list', async () => {
    // First call is the conditional cursor fragment (this.sql``), second is the actual SELECT
    const svc = new DedupReconciliationService(makeSql([], [candidateRow]));
    const result = await svc.listCandidates('ws-1');
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list).toHaveLength(1);
    expect(list[0]?.sourceEntityId).toBe('e1');
  });

  it('returns empty array when none', async () => {
    const svc = new DedupReconciliationService(makeSql([], []));
    const result = await svc.listCandidates('ws-1');
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('returns err on DB failure', async () => {
    // First call is the conditional fragment (this.sql``), second is the SELECT query
    const fn = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('DB fail'));
    const svc = new DedupReconciliationService(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.listCandidates('ws-1');
    expect(result.isErr()).toBe(true);
  });
});

// ─── recordDecision ───────────────────────────────────────────────────────────

describe('DedupReconciliationService.recordDecision', () => {
  it('returns updated candidate with decision', async () => {
    const updated = { ...candidateRow, status: 'reviewed' as const, decision: 'keep_separate' as const, decided_by: 'admin' };
    const svc = new DedupReconciliationService(makeSql([updated]));
    const result = await svc.recordDecision({
      workspaceId: 'ws-1',
      sourceEntityId: 'e1',
      candidateDuplicateId: 'e2',
      decision: 'keep_separate',
      decidedBy: 'admin',
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().decision).toBe('keep_separate');
    expect(result._unsafeUnwrap().status).toBe('reviewed');
  });

  it('returns err when candidate not found', async () => {
    const svc = new DedupReconciliationService(makeSql([]));
    const result = await svc.recordDecision({
      workspaceId: 'ws-1', sourceEntityId: 'e1', candidateDuplicateId: 'e2',
      decision: 'merge', decidedBy: 'admin',
    });
    expect(result.isErr()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('lock timeout'));
    const svc = new DedupReconciliationService(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.recordDecision({
      workspaceId: 'ws-1', sourceEntityId: 'e1', candidateDuplicateId: 'e2',
      decision: 'merge', decidedBy: 'admin',
    });
    expect(result.isErr()).toBe(true);
  });
});

// ─── executeMerge ─────────────────────────────────────────────────────────────

describe('DedupReconciliationService.executeMerge', () => {
  it('returns merge result with surviving/merged IDs', async () => {
    const merged = { ...candidateRow, status: 'merged' as const, decision: 'merge' as const };
    const svc = new DedupReconciliationService(makeSql([merged], []));
    const result = await svc.executeMerge('ws-1', 'e1', 'e2', 'admin');
    expect(result.isOk()).toBe(true);
    const r = result._unsafeUnwrap();
    expect(r.survivingEntityId).toBe('e1');
    expect(r.mergedEntityId).toBe('e2');
    expect(r.mergedAt).toBeTruthy();
  });

  it('returns err when candidate not found', async () => {
    const svc = new DedupReconciliationService(makeSql([]));
    const result = await svc.executeMerge('ws-1', 'e1', 'e2', 'admin');
    expect(result.isErr()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('FK violation'));
    const svc = new DedupReconciliationService(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.executeMerge('ws-1', 'e1', 'e2', 'admin');
    expect(result.isErr()).toBe(true);
  });
});

// ─── undoMerge ────────────────────────────────────────────────────────────────

describe('DedupReconciliationService.undoMerge', () => {
  it('returns ok when log entry exists within 30 days', async () => {
    const svc = new DedupReconciliationService(makeSql([{ merged_at: new Date().toISOString() }], [], []));
    const result = await svc.undoMerge('ws-1', 'e1', 'e2');
    expect(result.isOk()).toBe(true);
  });

  it('returns err when merge not found or window expired', async () => {
    const svc = new DedupReconciliationService(makeSql([]));
    const result = await svc.undoMerge('ws-1', 'e1', 'e2');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('30 days');
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    const svc = new DedupReconciliationService(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.undoMerge('ws-1', 'e1', 'e2');
    expect(result.isErr()).toBe(true);
  });
});

// ─── getMetrics ───────────────────────────────────────────────────────────────

describe('DedupReconciliationService.getMetrics', () => {
  it('returns computed metrics', async () => {
    const svc = new DedupReconciliationService(makeSql([{
      total_candidates: '20', pending_review: '5', merged: '10', kept_separate: '4', ignored: '1',
    }]));
    const result = await svc.getMetrics('ws-1');
    expect(result.isOk()).toBe(true);
    const m = result._unsafeUnwrap();
    expect(m.totalCandidates).toBe(20);
    expect(m.pendingReview).toBe(5);
    expect(m.merged).toBe(10);
    expect(m.mergeSuccessRate).toBeCloseTo(10 / 15);
  });

  it('returns zero mergeSuccessRate when no decisions made', async () => {
    const svc = new DedupReconciliationService(makeSql([{
      total_candidates: '5', pending_review: '5', merged: '0', kept_separate: '0', ignored: '0',
    }]));
    const result = await svc.getMetrics('ws-1');
    expect(result._unsafeUnwrap().mergeSuccessRate).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('DB fail'));
    const svc = new DedupReconciliationService(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.getMetrics('ws-1');
    expect(result.isErr()).toBe(true);
  });
});
