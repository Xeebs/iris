import { describe, it, expect, vi } from 'vitest';
import {
  applyFeedbackWeights,
  computeExpansionRelevance,
  scoreFeedbackNegativity,
  extractExpansionAxes,
  QueryExpansionEngine,
  type ExpandedResult,
  type ResultFeedback,
} from '../query-expansion-engine.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const makeResult = (id: string, type: string, score = 0.8): ExpandedResult => ({
  entityId: id, entityType: type, label: id, score, stage: 1,
});

// ─── applyFeedbackWeights ─────────────────────────────────────────────────────

describe('applyFeedbackWeights', () => {
  it('boosts useful entities', () => {
    const results = [makeResult('e1', 'contact', 0.5)];
    const feedback: ResultFeedback[] = [{ entityId: 'e1', mark: 'useful' }];
    const out = applyFeedbackWeights(results, feedback);
    expect(out[0]!.score).toBeCloseTo(0.6);
  });

  it('penalizes irrelevant entities', () => {
    const results = [makeResult('e1', 'contact', 1.0)];
    const feedback: ResultFeedback[] = [{ entityId: 'e1', mark: 'irrelevant' }];
    const out = applyFeedbackWeights(results, feedback);
    expect(out[0]!.score).toBeCloseTo(0.1);
  });

  it('partially penalizes stale entities', () => {
    const results = [makeResult('e1', 'contact', 1.0)];
    const feedback: ResultFeedback[] = [{ entityId: 'e1', mark: 'stale' }];
    const out = applyFeedbackWeights(results, feedback);
    expect(out[0]!.score).toBeCloseTo(0.5);
  });

  it('leaves un-mentioned entities unchanged', () => {
    const results = [makeResult('e1', 'contact', 0.8), makeResult('e2', 'deal', 0.6)];
    const feedback: ResultFeedback[] = [{ entityId: 'e1', mark: 'irrelevant' }];
    const out = applyFeedbackWeights(results, feedback);
    const e2 = out.find((r) => r.entityId === 'e2');
    expect(e2!.score).toBeCloseTo(0.6);
  });

  it('sorts results by adjusted score descending', () => {
    const results = [makeResult('e1', 'contact', 0.5), makeResult('e2', 'deal', 0.8)];
    const feedback: ResultFeedback[] = [{ entityId: 'e1', mark: 'useful' }, { entityId: 'e2', mark: 'irrelevant' }];
    const out = applyFeedbackWeights(results, feedback);
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it('returns original order for empty feedback', () => {
    const results = [makeResult('e1', 'contact', 0.8)];
    const out = applyFeedbackWeights(results, []);
    expect(out[0]!.score).toBeCloseTo(0.8);
  });
});

// ─── computeExpansionRelevance ────────────────────────────────────────────────

describe('computeExpansionRelevance', () => {
  it('returns 0 for empty query', () => {
    expect(computeExpansionRelevance('', 'contact')).toBe(0);
  });

  it('returns 0 for empty expansion', () => {
    expect(computeExpansionRelevance('find contacts', '')).toBe(0);
  });

  it('returns higher score for overlapping terms', () => {
    const high = computeExpansionRelevance('find contact company filter', 'contact filter options');
    const low = computeExpansionRelevance('find revenue deals pipeline', 'contact filter options');
    expect(high).toBeGreaterThan(low);
  });

  it('never exceeds 0.95', () => {
    const score = computeExpansionRelevance('contact contact contact', 'contact');
    expect(score).toBeLessThanOrEqual(0.95);
  });

  it('returns at least 0.2 for short tokens', () => {
    expect(computeExpansionRelevance('ai', 'go')).toBeGreaterThanOrEqual(0.2);
  });
});

// ─── scoreFeedbackNegativity ──────────────────────────────────────────────────

describe('scoreFeedbackNegativity', () => {
  it('returns 0 for empty marks', () => {
    expect(scoreFeedbackNegativity([])).toBe(0);
  });

  it('returns 0 for all useful marks', () => {
    expect(scoreFeedbackNegativity(['useful', 'useful'])).toBe(0);
  });

  it('returns 1 for all irrelevant marks', () => {
    expect(scoreFeedbackNegativity(['irrelevant', 'irrelevant'])).toBe(1);
  });

  it('returns intermediate for mixed marks', () => {
    const score = scoreFeedbackNegativity(['useful', 'irrelevant']);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('caps at 1 even for extreme values', () => {
    const score = scoreFeedbackNegativity(['irrelevant', 'irrelevant', 'irrelevant', 'stale']);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── extractExpansionAxes ─────────────────────────────────────────────────────

describe('extractExpansionAxes', () => {
  it('extracts entity types from results', () => {
    const results = [makeResult('e1', 'contact'), makeResult('e2', 'deal')];
    const axes = extractExpansionAxes(results);
    expect(axes.get('entity_type')).toContain('contact');
    expect(axes.get('entity_type')).toContain('deal');
  });

  it('deduplicates entity types', () => {
    const results = [makeResult('e1', 'contact'), makeResult('e2', 'contact'), makeResult('e3', 'deal')];
    const axes = extractExpansionAxes(results);
    expect(axes.get('entity_type')).toHaveLength(2);
  });

  it('returns empty type list for empty results', () => {
    const axes = extractExpansionAxes([]);
    expect(axes.get('entity_type')).toHaveLength(0);
  });
});

// ─── QueryExpansionEngine ─────────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('QueryExpansionEngine.expandQuery', () => {
  it('returns err for empty query', async () => {
    const svc = new QueryExpansionEngine(makeSql());
    const r = await svc.expandQuery('');
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain('empty');
  });

  it('returns session with results for valid query', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ id: 'e1', type: 'contact', label: 'Alice' }])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new QueryExpansionEngine(sql);
    const r = await svc.expandQuery('alice contact');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().sessionId).toBeDefined();
    expect(r._unsafeUnwrap().results).toHaveLength(1);
  });

  it('applies feedback in stage 2', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ id: 'e1', type: 'contact', label: 'Alice' }])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new QueryExpansionEngine(sql);
    const feedback: ResultFeedback[] = [{ entityId: 'e1', mark: 'irrelevant' }];
    const r = await svc.expandQuery('alice', 2, feedback);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().results[0]!.score).toBeLessThan(0.5);
  });
});

describe('QueryExpansionEngine.refineContextByFeedback', () => {
  it('returns err for empty results', async () => {
    const svc = new QueryExpansionEngine(makeSql());
    const r = await svc.refineContextByFeedback([], []);
    expect(r.isErr()).toBe(true);
  });

  it('returns original results for empty feedback', async () => {
    const svc = new QueryExpansionEngine(makeSql());
    const results = [makeResult('e1', 'contact', 0.8)];
    const r = await svc.refineContextByFeedback(results, []);
    expect(r._unsafeUnwrap()[0]!.score).toBeCloseTo(0.8);
  });

  it('re-ranks based on feedback', async () => {
    const svc = new QueryExpansionEngine(makeSql());
    const results = [makeResult('e1', 'contact', 0.9), makeResult('e2', 'deal', 0.5)];
    const feedback: ResultFeedback[] = [{ entityId: 'e1', mark: 'irrelevant' }, { entityId: 'e2', mark: 'useful' }];
    const r = await svc.refineContextByFeedback(results, feedback);
    expect(r._unsafeUnwrap()[0]!.entityId).toBe('e2');
  });
});

describe('QueryExpansionEngine.recordFeedback', () => {
  it('returns ok on success', async () => {
    const svc = new QueryExpansionEngine(makeSql());
    const r = await svc.recordFeedback('sess1', [{ entityId: 'e1', mark: 'useful' }]);
    expect(r.isOk()).toBe(true);
  });
});

describe('QueryExpansionEngine.getSession', () => {
  it('returns err when session not found', async () => {
    const svc = new QueryExpansionEngine(makeSql([]));
    const r = await svc.getSession('missing');
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns parsed session', async () => {
    const sql = makeSql([{
      id: 'sess1', query: 'test', stage: 1,
      results_json: '[]', directions_json: '[]', feedback_json: '[]',
      created_at: new Date(),
    }]);
    const svc = new QueryExpansionEngine(sql);
    const r = await svc.getSession('sess1');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().query).toBe('test');
  });
});
