import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeBlendedScore,
  validateWeights,
  RelevanceTuner,
  DEFAULT_WEIGHTS,
  type ScoredCandidate,
  type ScoringWeights,
} from '../relevance-tuner.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(responses: unknown[]) {
  let idx = 0;
  const sql = vi.fn((..._args: unknown[]) => {
    const r = responses[idx++] ?? [];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r as unknown[]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
  return sql;
}

describe('computeBlendedScore', () => {
  const base: ScoredCandidate = {
    entityId: 'e-1',
    entityType: 'contact',
    embeddingScore: 0.8,
  };

  it('combines embedding and bm25 with configured weights', () => {
    const weights: ScoringWeights = { ...DEFAULT_WEIGHTS, bm25_weight: 0.3, embedding_weight: 0.7 };
    const result = computeBlendedScore({ ...base, bm25Score: 0.5 }, weights);
    // 0.7 * 0.8 + 0.3 * 0.5 * 1.0 (contact boost) = 0.56 + 0.15 = 0.71
    expect(result).toBeCloseTo(0.71, 2);
  });

  it('ignores bm25 when not provided', () => {
    const weights = { ...DEFAULT_WEIGHTS, bm25_weight: 0.3, embedding_weight: 0.7 };
    const result = computeBlendedScore(base, weights);
    expect(result).toBeCloseTo(0.56, 2);
  });

  it('applies type boost for known entity types', () => {
    const weightsWithBoost: ScoringWeights = { ...DEFAULT_WEIGHTS, type_boost_deal: 1.5 };
    const dealEntity: ScoredCandidate = { ...base, entityType: 'deal', embeddingScore: 1.0 };
    const contactEntity: ScoredCandidate = { ...base, entityType: 'contact', embeddingScore: 1.0 };
    const dealScore = computeBlendedScore(dealEntity, weightsWithBoost);
    const contactScore = computeBlendedScore(contactEntity, weightsWithBoost);
    expect(dealScore).toBeGreaterThan(contactScore);
  });

  it('applies recency boost for recently modified entities', () => {
    const recent: ScoredCandidate = { ...base, lastModified: new Date() };
    const old: ScoredCandidate = { ...base, lastModified: new Date(Date.now() - 365 * 24 * 3_600_000) };
    const recentScore = computeBlendedScore(recent, DEFAULT_WEIGHTS);
    const oldScore = computeBlendedScore(old, DEFAULT_WEIGHTS);
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('applies relationship distance penalty', () => {
    const direct: ScoredCandidate = { ...base, relationshipDistance: 0 };
    const distant: ScoredCandidate = { ...base, relationshipDistance: 5 };
    const directScore = computeBlendedScore(direct, DEFAULT_WEIGHTS);
    const distantScore = computeBlendedScore(distant, DEFAULT_WEIGHTS);
    expect(directScore).toBeGreaterThan(distantScore);
  });

  it('never returns a negative score', () => {
    const penaltyHeavy: ScoringWeights = { ...DEFAULT_WEIGHTS, relationship_distance_penalty: 0.5 };
    const farAway: ScoredCandidate = { ...base, embeddingScore: 0.01, relationshipDistance: 100 };
    expect(computeBlendedScore(farAway, penaltyHeavy)).toBeGreaterThanOrEqual(0);
  });

  it('returns higher score for higher embedding similarity', () => {
    const high: ScoredCandidate = { ...base, embeddingScore: 0.95 };
    const low: ScoredCandidate = { ...base, embeddingScore: 0.4 };
    expect(computeBlendedScore(high, DEFAULT_WEIGHTS)).toBeGreaterThan(
      computeBlendedScore(low, DEFAULT_WEIGHTS),
    );
  });
});

describe('validateWeights', () => {
  it('accepts valid weights within constraints', () => {
    expect(() => validateWeights(DEFAULT_WEIGHTS)).not.toThrow();
  });

  it('rejects negative embedding_weight', () => {
    expect(() => validateWeights({ ...DEFAULT_WEIGHTS, embedding_weight: -0.1 })).toThrow(/non-negative/);
  });

  it('rejects negative bm25_weight', () => {
    expect(() => validateWeights({ ...DEFAULT_WEIGHTS, bm25_weight: -0.1 })).toThrow(/non-negative/);
  });

  it('rejects sum of primary weights below 0.5', () => {
    expect(() => validateWeights({ ...DEFAULT_WEIGHTS, bm25_weight: 0.1, embedding_weight: 0.2 })).toThrow(/degenerate/);
  });

  it('rejects recency_boost > 1', () => {
    expect(() => validateWeights({ ...DEFAULT_WEIGHTS, recency_boost: 1.5 })).toThrow(/\[0, 1\]/);
  });

  it('rejects negative recency_boost', () => {
    expect(() => validateWeights({ ...DEFAULT_WEIGHTS, recency_boost: -0.1 })).toThrow(/\[0, 1\]/);
  });

  it('rejects relationship_distance_penalty > 0.5', () => {
    expect(() => validateWeights({ ...DEFAULT_WEIGHTS, relationship_distance_penalty: 0.6 })).toThrow(/\[0, 0.5\]/);
  });
});

describe('RelevanceTuner', () => {
  describe('loadWeights', () => {
    it('returns defaults when no rows stored', async () => {
      const sql = makeSql([[]]);
      const tuner = new RelevanceTuner(sql);
      const weights = await tuner.loadWeights('ws-1');
      expect(weights).toEqual(DEFAULT_WEIGHTS);
    });

    it('overrides defaults with stored values', async () => {
      const rows = [{ factor_name: 'bm25_weight', tuned_value: 0.5 }];
      const sql = makeSql([rows]);
      const tuner = new RelevanceTuner(sql);
      const weights = await tuner.loadWeights('ws-1');
      expect(weights.bm25_weight).toBe(0.5);
      expect(weights.embedding_weight).toBe(DEFAULT_WEIGHTS.embedding_weight);
    });

    it('ignores unknown factor names', async () => {
      const rows = [{ factor_name: 'unknown_factor', tuned_value: 99 }];
      const sql = makeSql([rows]);
      const tuner = new RelevanceTuner(sql);
      const weights = await tuner.loadWeights('ws-1');
      expect(weights).toEqual(DEFAULT_WEIGHTS);
    });
  });

  describe('updateWeight', () => {
    it('loads current weights, validates, then upserts', async () => {
      const sql = makeSql([
        [{ factor_name: 'bm25_weight', tuned_value: 0.3 }], // loadWeights
        [{ workspace_id: 'ws-1' }], // upsert
      ]);
      const tuner = new RelevanceTuner(sql);
      await expect(
        tuner.updateWeight({ workspaceId: 'ws-1', factorName: 'recency_boost', tunedValue: 0.2 }),
      ).resolves.toBeUndefined();
    });

    it('throws on invalid weight (validation error)', async () => {
      const sql = makeSql([[]]); // loadWeights returns empty
      const tuner = new RelevanceTuner(sql);
      await expect(
        tuner.updateWeight({ workspaceId: 'ws-1', factorName: 'recency_boost', tunedValue: 5 }),
      ).rejects.toThrow();
    });
  });

  describe('recordFeedback', () => {
    it('inserts feedback row without error', async () => {
      const sql = makeSql([[{ id: 'fb-1' }]]);
      const tuner = new RelevanceTuner(sql);
      await expect(
        tuner.recordFeedback({
          workspaceId: 'ws-1',
          query: 'find contacts',
          clickedEntityId: 'e-1',
          rank: 2,
          feedbackScore: 1.0,
          dwellTimeMs: 3000,
        }),
      ).resolves.toBeUndefined();
    });

    it('propagates SQL errors', async () => {
      const sql = makeSql([new Error('insert failed')]);
      const tuner = new RelevanceTuner(sql);
      await expect(
        tuner.recordFeedback({ workspaceId: 'ws-1', query: 'q', clickedEntityId: 'e', rank: 1, feedbackScore: 1 }),
      ).rejects.toThrow('insert failed');
    });
  });

  describe('analyzeFeedback', () => {
    it('returns aggregated click-through rows', async () => {
      const rows = [
        { query: 'find contacts', avg_rank: 2.5, click_count: '15', avg_dwell_ms: 4000 },
        { query: 'Q3 deals', avg_rank: 1.0, click_count: '8', avg_dwell_ms: null },
      ];
      const sql = makeSql([rows]);
      const tuner = new RelevanceTuner(sql);
      const result = await tuner.analyzeFeedback('ws-1', 30);
      expect(result).toHaveLength(2);
      expect(result[0]!.clickCount).toBe(15);
      expect(result[0]!.avgRank).toBe(2.5);
      expect(result[1]!.avgDwellMs).toBeNull();
    });

    it('returns empty array when no feedback', async () => {
      const sql = makeSql([[]]);
      const tuner = new RelevanceTuner(sql);
      const result = await tuner.analyzeFeedback('ws-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('resetWeights', () => {
    it('deletes all config rows', async () => {
      const sql = makeSql([[{ workspace_id: 'ws-1' }]]);
      const tuner = new RelevanceTuner(sql);
      await expect(tuner.resetWeights('ws-1')).resolves.toBeUndefined();
      expect(sql).toHaveBeenCalledTimes(1);
    });
  });
});
