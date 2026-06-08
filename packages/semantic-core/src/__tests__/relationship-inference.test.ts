import { describe, it, expect, vi } from 'vitest';
import {
  detectImplicitRelationships,
  validateInferredRelationship,
  buildCooccurrenceMatrix,
  predictMissingRelationships,
  suggestRelationshipCreation,
  confirmInferredRelationship,
  rejectInferredRelationship,
} from '../relationship-inference';

type Sql = Parameters<typeof buildCooccurrenceMatrix>[0];

describe('detectImplicitRelationships', () => {
  it('computes confidence from all three signal types', () => {
    const result = detectImplicitRelationships('e1', 'contact', 'e2', 'company', 0.8, 0.7);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.breakdown.cooccurrenceWeight).toBeGreaterThan(0);
    expect(result.breakdown.typeCompatibilityWeight).toBeGreaterThan(0);
    expect(result.breakdown.embeddingSimilarityWeight).toBeGreaterThan(0);
  });

  it('gives zero type compatibility for incompatible type pairs', () => {
    const result = detectImplicitRelationships('e1', 'contact', 'e2', 'contact', 0.5, 0.5);
    expect(result.breakdown.typeCompatibilityWeight).toBe(0);
  });

  it('uses cooccurrence as discovery method when it dominates', () => {
    const result = detectImplicitRelationships('e1', 'deal', 'e2', 'company', 0.9, 0.3);
    expect(result.discoveryMethod).toBe('cooccurrence');
  });

  it('uses embedding_similarity when cosine similarity is very high', () => {
    const result = detectImplicitRelationships('e1', 'deal', 'e2', 'company', 0.3, 0.9);
    expect(result.discoveryMethod).toBe('embedding_similarity');
  });

  it('predicts correct relationship type for contact-company pair', () => {
    const result = detectImplicitRelationships('e1', 'contact', 'e2', 'company', 0.5, 0.5);
    expect(result.predictedType).toBe('employed_by');
  });

  it('predicts deal-contact relationship correctly', () => {
    const result = detectImplicitRelationships('e1', 'deal', 'e2', 'contact', 0.5, 0.5);
    expect(result.predictedType).toBe('involved_in');
  });

  it('confidence is capped at 1', () => {
    const result = detectImplicitRelationships('e1', 'contact', 'e2', 'company', 1, 1);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('validateInferredRelationship', () => {
  it('returns true for high-confidence relationships', () => {
    const rel = detectImplicitRelationships('e1', 'contact', 'e2', 'company', 1, 1);
    expect(validateInferredRelationship(rel)).toBe(true);
  });

  it('returns false for low-confidence relationships', () => {
    const rel = detectImplicitRelationships('e1', 'contact', 'e2', 'contact', 0, 0);
    expect(validateInferredRelationship(rel)).toBe(false);
  });

  it('threshold is exactly 0.75', () => {
    const highEnough = { ...detectImplicitRelationships('e1', 'contact', 'e2', 'company', 0.8, 0.6), confidence: 0.75 };
    const tooLow = { ...detectImplicitRelationships('e1', 'contact', 'e2', 'company', 0.5, 0.4), confidence: 0.74 };
    expect(validateInferredRelationship(highEnough)).toBe(true);
    expect(validateInferredRelationship(tooLow)).toBe(false);
  });
});

describe('buildCooccurrenceMatrix', () => {
  it('returns normalized co-occurrence entries', async () => {
    const sql = vi.fn().mockResolvedValue([
      { entity_a: 'e1', entity_b: 'e2', cooccurrence_count: '10' },
      { entity_a: 'e1', entity_b: 'e3', cooccurrence_count: '5' },
    ]);
    const result = await buildCooccurrenceMatrix(sql as unknown as Sql, 'ws1', 90);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.cooccurrenceScore).toBe(1); // max count
      expect(result.value[1]!.cooccurrenceScore).toBe(0.5); // 5/10
    }
  });

  it('returns empty array when no data', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await buildCooccurrenceMatrix(sql as unknown as Sql, 'ws-new', 30);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toHaveLength(0);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await buildCooccurrenceMatrix(sql as unknown as Sql, 'ws1');
    expect(result.isErr()).toBe(true);
  });
});

describe('suggestRelationshipCreation', () => {
  it('returns unconfirmed high-confidence suggestions', async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        id: 'rel1',
        source_entity_id: 'e1',
        target_entity_id: 'e2',
        relationship_type_predicted: 'employed_by',
        confidence_score: '0.87',
        discovery_method: 'cooccurrence',
        suggested_at: '2026-06-08T10:00:00Z',
        confirmed_at: null,
        rejected_at: null,
      },
    ]);
    const result = await suggestRelationshipCreation(sql as unknown as Sql, 'ws1', 10);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.confidenceScore).toBe(0.87);
      expect(result.value[0]!.confirmedAt).toBeNull();
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('query failed'));
    const result = await suggestRelationshipCreation(sql as unknown as Sql, 'ws1');
    expect(result.isErr()).toBe(true);
  });
});

describe('confirmInferredRelationship', () => {
  it('updates confirmation date and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await confirmInferredRelationship(sql as unknown as Sql, 'ws1', 'rel1');
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledOnce();
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await confirmInferredRelationship(sql as unknown as Sql, 'ws1', 'rel1');
    expect(result.isErr()).toBe(true);
  });
});

describe('rejectInferredRelationship', () => {
  it('updates rejection date and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await rejectInferredRelationship(sql as unknown as Sql, 'ws1', 'rel1');
    expect(result.isOk()).toBe(true);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await rejectInferredRelationship(sql as unknown as Sql, 'ws1', 'rel1');
    expect(result.isErr()).toBe(true);
  });
});

describe('predictMissingRelationships', () => {
  it('returns Ok with empty list when no compatible candidates', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([]) // existing relationships
      .mockResolvedValueOnce([]); // candidates
    // 'task' has compatible types (contact, activity, deal) but we'll return no candidates
    const result = await predictMissingRelationships(sql as unknown as Sql, 'ws1', 'e1', 'unknown-type', 10);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toHaveLength(0);
  });

  it('returns Err when DB throws on existing relationships query', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await predictMissingRelationships(sql as unknown as Sql, 'ws1', 'e1', 'contact', 5);
    expect(result.isErr()).toBe(true);
  });
});
