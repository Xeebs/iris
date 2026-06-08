import { describe, it, expect, vi } from 'vitest';
import {
  inferFeedback,
  computeWeightAdjustment,
  recordAgentUsage,
  recordUserFeedback,
  updateRelevanceWeights,
  suggestContextExpansion,
  getAgentInsights,
  getRelevanceAdjustments,
} from '../agent-feedback-engine';
import type { AgentContextUsage } from '../agent-feedback-engine';

type Sql = Parameters<typeof recordAgentUsage>[0];

function makeUsage(overrides: Partial<AgentContextUsage> = {}): AgentContextUsage {
  return {
    usageId: 'u1',
    agentId: 'agent-1',
    workspaceId: 'ws1',
    queryHash: 'hash-abc',
    contextIds: ['hubspot:contact:1', 'hubspot:deal:2'],
    contextBudgetUsed: 1500,
    servedAt: new Date(),
    ...overrides,
  };
}

describe('inferFeedback', () => {
  it('returns positive signal when agent quotes served entity IDs', () => {
    const signal = inferFeedback('q1', 'q2', 'Based on hubspot:contact:1 the answer is...', ['hubspot:contact:1']);
    expect(signal?.signal).toBe('positive');
    expect(signal?.impliedRating).toBeGreaterThanOrEqual(4);
  });

  it('returns higher rating when multiple entity IDs are quoted', () => {
    const signal = inferFeedback('q1', 'q2',
      'Using hubspot:contact:1, hubspot:deal:2, hubspot:company:3',
      ['hubspot:contact:1', 'hubspot:deal:2', 'hubspot:company:3'],
    );
    expect(signal?.impliedRating).toBe(5);
  });

  it('returns negative signal for re-issued identical query', () => {
    const signal = inferFeedback('q1', 'q1', 'I need more information', []);
    expect(signal?.signal).toBe('negative');
    expect(signal?.impliedRating).toBe(2);
  });

  it('returns null when no signal is detectable', () => {
    const signal = inferFeedback('q1', 'q2', 'Some generic response', ['hubspot:contact:1']);
    expect(signal).toBeNull();
  });

  it('positive signal takes priority over no re-query', () => {
    const signal = inferFeedback('same', 'same', 'hubspot:contact:1 is relevant', ['hubspot:contact:1']);
    expect(signal?.signal).toBe('positive');
  });
});

describe('computeWeightAdjustment', () => {
  it('returns 0 when no feedback', () => {
    expect(computeWeightAdjustment(0, 0)).toBe(0);
  });

  it('returns positive weight for all positive feedback', () => {
    expect(computeWeightAdjustment(10, 0)).toBe(0.5);
  });

  it('returns negative weight for all negative feedback', () => {
    expect(computeWeightAdjustment(0, 10)).toBe(-0.5);
  });

  it('returns zero weight for equal positive/negative', () => {
    expect(computeWeightAdjustment(5, 5)).toBe(0);
  });

  it('clamps weight to [-0.5, +0.5]', () => {
    const pos = computeWeightAdjustment(100, 0);
    const neg = computeWeightAdjustment(0, 100);
    expect(pos).toBeLessThanOrEqual(0.5);
    expect(neg).toBeGreaterThanOrEqual(-0.5);
  });
});

describe('recordAgentUsage', () => {
  it('inserts usage record and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await recordAgentUsage(sql as unknown as Sql, makeUsage());
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledOnce();
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await recordAgentUsage(sql as unknown as Sql, makeUsage());
    expect(result.isErr()).toBe(true);
  });
});

describe('recordUserFeedback', () => {
  it('inserts feedback and returns feedbackId', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await recordUserFeedback(sql as unknown as Sql, {
      usageId: 'u1',
      rating: 4,
      comment: 'Very helpful',
      correctedContextJson: null,
      feedbackSource: 'explicit',
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(typeof result.value).toBe('string');
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await recordUserFeedback(sql as unknown as Sql, {
      usageId: 'u1',
      rating: 3,
      comment: null,
      correctedContextJson: null,
      feedbackSource: 'implicit',
    });
    expect(result.isErr()).toBe(true);
  });
});

describe('updateRelevanceWeights', () => {
  it('upserts weight for entity type and returns Ok', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ positive_feedback_count: 5, negative_feedback_count: 1 }]) // INSERT ... RETURNING
      .mockResolvedValueOnce([]); // UPDATE
    const result = await updateRelevanceWeights(sql as unknown as Sql, 'ws1', 'contact', 5);
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await updateRelevanceWeights(sql as unknown as Sql, 'ws1', 'contact', 4);
    expect(result.isErr()).toBe(true);
  });
});

describe('suggestContextExpansion', () => {
  it('returns suggestions from positive feedback entity types', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([
        { entity_id: 'hubspot:contact:1' },
        { entity_id: 'hubspot:contact:2' },
        { entity_id: 'hubspot:deal:3' },
      ])
      .mockResolvedValueOnce([]); // negative feedback
    const result = await suggestContextExpansion(sql as unknown as Sql, 'ws1', 'agent-1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.suggestedEntityTypes.length).toBeGreaterThan(0);
      expect(result.value.confidenceScore).toBeGreaterThan(0);
    }
  });

  it('excludes entity types with negative feedback', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ entity_id: 'hubspot:contact:1' }, { entity_id: 'hubspot:deal:2' }])
      .mockResolvedValueOnce([{ entity_id: 'hubspot:deal:3' }]); // deal is negative
    const result = await suggestContextExpansion(sql as unknown as Sql, 'ws1', 'agent-1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.suggestedEntityTypes).not.toContain('deal');
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await suggestContextExpansion(sql as unknown as Sql, 'ws1', 'agent-1');
    expect(result.isErr()).toBe(true);
  });
});

describe('getAgentInsights', () => {
  it('returns aggregated stats and entity type rankings', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ total_usages: '10', avg_rating: '4.2', feedback_count: '8' }])
      .mockResolvedValueOnce([
        { entity_type: 'contact', weight_adjustment: '0.4' },
        { entity_type: 'deal', weight_adjustment: '-0.2' },
      ]);
    const result = await getAgentInsights(sql as unknown as Sql, 'ws1', 'agent-1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.totalUsages).toBe(10);
      expect(result.value.avgRating).toBeCloseTo(4.2);
      expect(result.value.mostUsefulEntityTypes).toContain('contact');
      expect(result.value.leastUsefulEntityTypes).toContain('deal');
    }
  });

  it('returns zero stats when no data', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await getAgentInsights(sql as unknown as Sql, 'ws1', 'agent-new');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.totalUsages).toBe(0);
  });
});

describe('getRelevanceAdjustments', () => {
  it('returns mapped adjustment records', async () => {
    const sql = vi.fn().mockResolvedValue([
      { entity_type: 'contact', workspace_id: 'ws1', positive_feedback_count: 8, negative_feedback_count: 2, weight_adjustment: '0.3', last_updated_at: '2026-06-08T00:00:00Z' },
    ]);
    const result = await getRelevanceAdjustments(sql as unknown as Sql, 'ws1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]!.weightAdjustment).toBeCloseTo(0.3);
      expect(result.value[0]!.entityType).toBe('contact');
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await getRelevanceAdjustments(sql as unknown as Sql, 'ws1');
    expect(result.isErr()).toBe(true);
  });
});
