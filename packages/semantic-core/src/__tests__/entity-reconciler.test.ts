import { describe, it, expect, vi } from 'vitest';
import {
  computeAttributeOverlap,
  scoreMatchConfidence,
  fuzzyNameSimilarity,
  generateMatchReasons,
  EntityReconciler,
} from '../entity-reconciler.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── computeAttributeOverlap ──────────────────────────────────────────────────

describe('computeAttributeOverlap', () => {
  it('returns 0 for empty attributes', () => {
    expect(computeAttributeOverlap({}, {})).toBe(0);
  });

  it('returns 1 for identical non-empty attributes', () => {
    const attrs = { name: 'Alice', company: 'Acme' };
    expect(computeAttributeOverlap(attrs, attrs)).toBe(1);
  });

  it('returns 0 for no matching keys', () => {
    const a = { name: 'Alice' };
    const b = { company: 'Acme' };
    expect(computeAttributeOverlap(a, b)).toBe(0);
  });

  it('excludes PII fields from comparison', () => {
    const a = { email: 'a@x.com', name: 'Alice' };
    const b = { email: 'b@x.com', name: 'Alice' };
    const overlap = computeAttributeOverlap(a, b);
    expect(overlap).toBeCloseTo(1);
  });

  it('returns partial overlap for partially matching attrs', () => {
    const a = { name: 'Alice', status: 'active', city: 'NY' };
    const b = { name: 'Alice', status: 'inactive', city: 'NY' };
    const overlap = computeAttributeOverlap(a, b);
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });
});

// ─── scoreMatchConfidence ─────────────────────────────────────────────────────

describe('scoreMatchConfidence', () => {
  it('returns 1 for all perfect signals', () => {
    expect(scoreMatchConfidence(1, 1, 1)).toBe(1);
  });

  it('returns 0 for all zero signals', () => {
    expect(scoreMatchConfidence(0, 0, 0)).toBe(0);
  });

  it('weights attribute overlap at 50%', () => {
    expect(scoreMatchConfidence(1, 0, 0)).toBeCloseTo(0.5);
  });

  it('weights embedding proximity at 30%', () => {
    expect(scoreMatchConfidence(0, 1, 0)).toBeCloseTo(0.3);
  });

  it('weights fuzzy name at 20%', () => {
    expect(scoreMatchConfidence(0, 0, 1)).toBeCloseTo(0.2);
  });

  it('caps at 1.0', () => {
    expect(scoreMatchConfidence(2, 2, 2)).toBe(1);
  });
});

// ─── fuzzyNameSimilarity ──────────────────────────────────────────────────────

describe('fuzzyNameSimilarity', () => {
  it('returns 1 for identical names', () => {
    expect(fuzzyNameSimilarity('Alice Smith', 'Alice Smith')).toBe(1);
  });

  it('returns 1 for identical names case-insensitive', () => {
    expect(fuzzyNameSimilarity('alice smith', 'ALICE SMITH')).toBe(1);
  });

  it('returns 0 for completely different names', () => {
    expect(fuzzyNameSimilarity('xyz', 'abc')).toBe(0);
  });

  it('returns high score for similar names', () => {
    const score = fuzzyNameSimilarity('Alice Smith', 'Alicia Smith');
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns 0 for empty strings', () => {
    expect(fuzzyNameSimilarity('', 'Alice')).toBe(0);
    expect(fuzzyNameSimilarity('Alice', '')).toBe(0);
  });
});

// ─── generateMatchReasons ─────────────────────────────────────────────────────

describe('generateMatchReasons', () => {
  it('returns at least one reason', () => {
    expect(generateMatchReasons(0, 0, 0).length).toBeGreaterThan(0);
  });

  it('mentions high overlap when attrOverlap > 0.6', () => {
    const reasons = generateMatchReasons(0.8, 0, 0);
    expect(reasons.some((r) => r.includes('attribute'))).toBe(true);
  });

  it('mentions semantic similarity when embeddingProx > 0.8', () => {
    const reasons = generateMatchReasons(0, 0.9, 0);
    expect(reasons.some((r) => r.toLowerCase().includes('semantic'))).toBe(true);
  });

  it('mentions name similarity when fuzzyName > 0.7', () => {
    const reasons = generateMatchReasons(0, 0, 0.8);
    expect(reasons.some((r) => r.toLowerCase().includes('name'))).toBe(true);
  });
});

// ─── EntityReconciler ─────────────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('EntityReconciler.findMatchCandidates', () => {
  it('returns err when source entity not found', async () => {
    const svc = new EntityReconciler(makeSql([]));
    const r = await svc.findMatchCandidates('unknown');
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns candidates sorted by confidence', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ type: 'contact', label: 'Alice', connector_id: 'hubspot', attributes: { name: 'Alice' } }])
      .mockResolvedValueOnce([
        { id: 'e2', label: 'Alice', connector_id: 'salesforce', attributes: { name: 'Alice', status: 'active' } },
        { id: 'e3', label: 'Bob', connector_id: 'notion', attributes: {} },
      ]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new EntityReconciler(sql);
    const r = await svc.findMatchCandidates('e1');
    expect(r.isOk()).toBe(true);
    const candidates = r._unsafeUnwrap();
    expect(candidates.length).toBeGreaterThan(0);
    if (candidates.length > 1) {
      expect(candidates[0]!.confidence).toBeGreaterThanOrEqual(candidates[1]!.confidence);
    }
  });
});

describe('EntityReconciler.suggestReconciliation', () => {
  it('returns err for empty targetIds', async () => {
    const svc = new EntityReconciler(makeSql([]));
    const r = await svc.suggestReconciliation('e1', []);
    expect(r.isErr()).toBe(true);
  });

  it('returns reject when no candidates found', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ type: 'contact', label: 'Alice', connector_id: 'hubspot', attributes: {} }])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new EntityReconciler(sql);
    const r = await svc.suggestReconciliation('e1', ['e2']);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().recommendedAction).toBe('reject');
  });
});

describe('EntityReconciler.recordReconciliationDecision', () => {
  it('returns decision record', async () => {
    const svc = new EntityReconciler(makeSql([]));
    const r = await svc.recordReconciliationDecision('e1', 'e2', 'merge');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().decision).toBe('merge');
  });
});

describe('EntityReconciler.listPendingReconciliations', () => {
  it('returns list of pending pairs', async () => {
    const sql = makeSql([{ source_id: 'e1', candidate_id: 'e2', confidence: 0.8 }]);
    const svc = new EntityReconciler(sql);
    const r = await svc.listPendingReconciliations();
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap()).toHaveLength(1);
  });
});
