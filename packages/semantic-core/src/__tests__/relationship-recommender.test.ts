import { describe, it, expect, vi } from 'vitest';
import {
  computeRelationshipConfidence,
  computeTypeCompatibility,
  generateRelationshipReasons,
  isDenied,
  RelationshipRecommendationService,
} from '../relationship-recommender.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── computeRelationshipConfidence ────────────────────────────────────────────

describe('computeRelationshipConfidence', () => {
  it('returns 1 for all perfect signals', () => {
    expect(computeRelationshipConfidence(1, 1, 1, 1)).toBeCloseTo(1);
  });

  it('returns 0 for all zero signals', () => {
    expect(computeRelationshipConfidence(0, 0, 0, 0)).toBe(0);
  });

  it('weights embedding at 40%', () => {
    expect(computeRelationshipConfidence(1, 0, 0, 0)).toBeCloseTo(0.4);
  });

  it('weights cooccurrence at 30%', () => {
    expect(computeRelationshipConfidence(0, 1, 0, 0)).toBeCloseTo(0.3);
  });

  it('weights type compatibility at 20%', () => {
    expect(computeRelationshipConfidence(0, 0, 1, 0)).toBeCloseTo(0.2);
  });

  it('weights domain rules at 10%', () => {
    expect(computeRelationshipConfidence(0, 0, 0, 1)).toBeCloseTo(0.1);
  });

  it('returns between 0 and 1 for partial signals', () => {
    const c = computeRelationshipConfidence(0.5, 0.5, 0.5, 0.5);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

// ─── computeTypeCompatibility ─────────────────────────────────────────────────

describe('computeTypeCompatibility', () => {
  it('returns 1.0 for known compatible pair', () => {
    expect(computeTypeCompatibility('contact', 'company', 'belongs_to')).toBe(1.0);
  });

  it('returns 0.0 for incompatible pair', () => {
    expect(computeTypeCompatibility('contact', 'activity', 'belongs_to')).toBe(0.0);
  });

  it('returns 0.5 for unknown relationship type', () => {
    expect(computeTypeCompatibility('widget', 'gadget', 'unknown_rel')).toBe(0.5);
  });

  it('supports deal:owned_by:contact', () => {
    expect(computeTypeCompatibility('deal', 'contact', 'owned_by')).toBe(1.0);
  });
});

// ─── generateRelationshipReasons ──────────────────────────────────────────────

describe('generateRelationshipReasons', () => {
  it('returns at least one reason', () => {
    expect(generateRelationshipReasons(0, 0, 0).length).toBeGreaterThan(0);
  });

  it('mentions high similarity when embedding is high', () => {
    const reasons = generateRelationshipReasons(0.8, 0, 0);
    expect(reasons.some((r) => r.toLowerCase().includes('similarity'))).toBe(true);
  });

  it('mentions co-access when cooccurrence is high', () => {
    const reasons = generateRelationshipReasons(0, 0.7, 0);
    expect(reasons.some((r) => r.toLowerCase().includes('co-accessed'))).toBe(true);
  });

  it('mentions schema compatibility when typeCompatibility is 1', () => {
    const reasons = generateRelationshipReasons(0, 0, 1.0);
    expect(reasons.some((r) => r.toLowerCase().includes('schema'))).toBe(true);
  });
});

// ─── isDenied ─────────────────────────────────────────────────────────────────

describe('isDenied', () => {
  it('returns true when forward pair is denied', () => {
    const denyList = new Set(['e1:e2']);
    expect(isDenied('e1', 'e2', denyList)).toBe(true);
  });

  it('returns true when reverse pair is denied', () => {
    const denyList = new Set(['e2:e1']);
    expect(isDenied('e1', 'e2', denyList)).toBe(true);
  });

  it('returns false for non-denied pair', () => {
    const denyList = new Set(['e3:e4']);
    expect(isDenied('e1', 'e2', denyList)).toBe(false);
  });

  it('returns false for empty deny list', () => {
    expect(isDenied('e1', 'e2', new Set())).toBe(false);
  });
});

// ─── RelationshipRecommendationService ───────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('RelationshipRecommendationService.suggestRelationships', () => {
  it('returns err when entity not found', async () => {
    const svc = new RelationshipRecommendationService(makeSql([]));
    const result = await svc.suggestRelationships('unknown');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns suggestions when entity found with co-access data', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ type: 'contact' }])
      .mockResolvedValueOnce([{ entity_id: 'e2', entity_type: 'company', cooccurrence_count: 5 }])
      .mockResolvedValueOnce([]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new RelationshipRecommendationService(sql);
    const result = await svc.suggestRelationships('e1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it('filters out denied suggestions', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ type: 'contact' }])
      .mockResolvedValueOnce([{ entity_id: 'e2', entity_type: 'company', cooccurrence_count: 5 }])
      .mockResolvedValueOnce([{ from_id: 'e1', to_id: 'e2' }]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new RelationshipRecommendationService(sql);
    const result = await svc.suggestRelationships('e1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });
});

describe('RelationshipRecommendationService.autoLinkEntities', () => {
  it('creates auto-link when confidence meets threshold', async () => {
    const svc = new RelationshipRecommendationService(makeSql([]));
    const result = await svc.autoLinkEntities('e1', 'e2', 'related_to', 0.85);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().autoApproved).toBe(true);
  });

  it('returns err when confidence below threshold', async () => {
    const svc = new RelationshipRecommendationService(makeSql([]));
    const result = await svc.autoLinkEntities('e1', 'e2', 'related_to', 0.5);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('threshold');
  });
});

describe('RelationshipRecommendationService.denyRelationshipSuggestion', () => {
  it('returns ok on success', async () => {
    const svc = new RelationshipRecommendationService(makeSql([]));
    const result = await svc.denyRelationshipSuggestion('e1', 'e2');
    expect(result.isOk()).toBe(true);
  });
});

describe('RelationshipRecommendationService.acceptRelationshipSuggestion', () => {
  it('returns ok on success', async () => {
    const svc = new RelationshipRecommendationService(makeSql([]));
    const result = await svc.acceptRelationshipSuggestion('e1', 'e2');
    expect(result.isOk()).toBe(true);
  });
});

describe('RelationshipRecommendationService.getSuggestionMetrics', () => {
  it('returns metrics', async () => {
    const sql = makeSql([{ total: 10, accepted_count: 7, denied_count: 3 }]);
    const svc = new RelationshipRecommendationService(sql);
    const result = await svc.getSuggestionMetrics();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().acceptanceRate).toBeCloseTo(0.7);
  });

  it('returns zero rate for empty feedback', async () => {
    const svc = new RelationshipRecommendationService(makeSql([{ total: 0, accepted_count: 0, denied_count: 0 }]));
    const result = await svc.getSuggestionMetrics();
    expect(result._unsafeUnwrap().acceptanceRate).toBe(0);
  });
});
