import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeCompletenessScore,
  diffAttributes,
  matchingAttributes,
  scoreCanonicalCandidates,
  DedupInspector,
  type ClusterMember,
} from '../dedup-inspector.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

// ─── Pure functions ───────────────────────────────────────────────────────────

describe('computeCompletenessScore', () => {
  it('returns 1.0 for fully populated attributes', () => {
    expect(computeCompletenessScore({ name: 'Alice', email: 'a@b.com', company: 'Acme' })).toBe(1);
  });

  it('returns 0 for empty attributes', () => {
    expect(computeCompletenessScore({})).toBe(0);
  });

  it('returns partial score for mixed null/value', () => {
    const score = computeCompletenessScore({ name: 'Alice', email: null, phone: undefined });
    expect(score).toBeCloseTo(0.33, 1);
  });

  it('treats empty string as incomplete', () => {
    const score = computeCompletenessScore({ name: '', phone: '555-1234' });
    expect(score).toBe(0.5);
  });
});

describe('diffAttributes', () => {
  it('returns no diffs when attributes are identical', () => {
    expect(diffAttributes({ name: 'Alice' }, { name: 'Alice' })).toHaveLength(0);
  });

  it('detects value differences', () => {
    const diffs = diffAttributes({ name: 'Alice' }, { name: 'Bob' });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.field).toBe('name');
    expect(diffs[0]!.value1).toBe('Alice');
    expect(diffs[0]!.value2).toBe('Bob');
  });

  it('treats keys only in a as diff', () => {
    const diffs = diffAttributes({ name: 'Alice', email: 'a@b.com' }, { name: 'Alice' });
    expect(diffs.some((d) => d.field === 'email')).toBe(true);
  });

  it('treats keys only in b as diff', () => {
    const diffs = diffAttributes({ name: 'Alice' }, { name: 'Alice', phone: '555' });
    expect(diffs.some((d) => d.field === 'phone')).toBe(true);
  });
});

describe('matchingAttributes', () => {
  it('returns matching attribute keys', () => {
    const matching = matchingAttributes(
      { name: 'Alice', email: 'a@b.com', stage: 'lead' },
      { name: 'Alice', email: 'a@b.com', stage: 'customer' },
    );
    expect(matching).toContain('name');
    expect(matching).toContain('email');
    expect(matching).not.toContain('stage');
  });

  it('returns empty array when nothing matches', () => {
    expect(matchingAttributes({ name: 'Alice' }, { name: 'Bob' })).toHaveLength(0);
  });

  it('ignores null values in entity1', () => {
    const matching = matchingAttributes({ name: null }, { name: null });
    expect(matching).not.toContain('name');
  });
});

describe('scoreCanonicalCandidates', () => {
  function makeMember(id: string, completeness: number, daysAgo: number): ClusterMember {
    return {
      entityId: id,
      entityType: 'contact',
      label: id,
      attributes: {},
      sourceConnector: 'hubspot',
      lastModified: new Date(Date.now() - daysAgo * 86400000),
      similarityToCanonical: 0.9,
      completenessScore: completeness,
    };
  }

  it('ranks higher completeness first', () => {
    const candidates = scoreCanonicalCandidates([
      makeMember('low', 0.4, 0),
      makeMember('high', 0.9, 0),
    ]);
    expect(candidates[0]!.entityId).toBe('high');
  });

  it('breaks ties by recency', () => {
    const candidates = scoreCanonicalCandidates([
      makeMember('old', 0.9, 30),
      makeMember('new', 0.9, 0),
    ]);
    expect(candidates[0]!.entityId).toBe('new');
  });

  it('returns scores for all members', () => {
    const candidates = scoreCanonicalCandidates([
      makeMember('a', 0.7, 5),
      makeMember('b', 0.6, 10),
      makeMember('c', 0.8, 2),
    ]);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((c) => typeof c.score === 'number')).toBe(true);
  });
});

// ─── DedupInspector class ─────────────────────────────────────────────────────

function makeSql(returnVal: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnVal);
}

describe('DedupInspector', () => {
  let sql: ReturnType<typeof makeSql>;
  let inspector: DedupInspector;

  beforeEach(() => {
    sql = makeSql();
    inspector = new DedupInspector(sql as never);
    vi.clearAllMocks();
    sql.mockResolvedValue([]);
  });

  // ── analyzeDedupClusters ──────────────────────────────────────────────────

  describe('analyzeDedupClusters', () => {
    it('returns clusters from DB', async () => {
      sql.mockResolvedValue([
        {
          cluster_id: 'cl1',
          workspace_id: 'ws1',
          entity_type: 'contact',
          member_count: 3,
          canonical_entity_id: 'e1',
          similarity_scores_json: '[0.87, 0.92]',
          created_at: new Date().toISOString(),
          merged_at: null,
        },
      ]);

      const result = await inspector.analyzeDedupClusters('ws1', 'contact');
      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.clusterId).toBe('cl1');
      expect(result.value[0]!.avgSimilarity).toBeCloseTo(0.895, 2);
    });

    it('queries all entity types when no type specified', async () => {
      await inspector.analyzeDedupClusters('ws1');
      expect(sql).toHaveBeenCalledTimes(1);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('db down'));
      const result = await inspector.analyzeDedupClusters('ws1', 'contact');
      expect(result.isErr()).toBe(true);
    });
  });

  // ── compareEntities ───────────────────────────────────────────────────────

  describe('compareEntities', () => {
    it('returns comparison with diff and matching attributes', async () => {
      sql.mockResolvedValue([
        {
          entity_id: 'e1',
          entity_type: 'contact',
          label: 'Alice',
          attributes_json: JSON.stringify({ name: 'Alice', email: 'a@b.com', stage: 'lead' }),
          source_connector: 'hubspot',
          last_modified: new Date().toISOString(),
          similarity_score: 0.9,
        },
        {
          entity_id: 'e2',
          entity_type: 'contact',
          label: 'Alice B',
          attributes_json: JSON.stringify({ name: 'Alice', email: 'a@b.com', stage: 'customer' }),
          source_connector: 'salesforce',
          last_modified: new Date().toISOString(),
          similarity_score: 0.9,
        },
      ]);

      const result = await inspector.compareEntities('e1', 'e2', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.matchingAttributes).toContain('name');
      expect(result.value.matchingAttributes).toContain('email');
      expect(result.value.diffAttributes.some((d) => d.field === 'stage')).toBe(true);
      expect(result.value.similarityScore).toBe(0.9);
    });

    it('returns err when entities not found', async () => {
      sql.mockResolvedValue([]);
      const result = await inspector.compareEntities('e1', 'e2', 'ws1');
      expect(result.isErr()).toBe(true);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('db error'));
      const result = await inspector.compareEntities('e1', 'e2', 'ws1');
      expect(result.isErr()).toBe(true);
    });
  });

  // ── suggestMerge ──────────────────────────────────────────────────────────

  describe('suggestMerge', () => {
    const makeM = (id: string, completeness: number): ClusterMember => ({
      entityId: id,
      entityType: 'contact',
      label: id,
      attributes: completeness > 0.5 ? { name: id, email: 'a@b.com', stage: 'lead' } : { name: id },
      sourceConnector: 'hubspot',
      lastModified: new Date(),
      similarityToCanonical: 0.9,
      completenessScore: completeness,
    });

    it('recommends entity with highest completeness as canonical', () => {
      const result = inspector.suggestMerge([makeM('low', 0.3), makeM('high', 0.9)]);
      expect(result.isOk()).toBe(true);
      expect(result.value.recommendedCanonicalId).toBe('high');
    });

    it('includes attributes from each non-canonical entity', () => {
      const result = inspector.suggestMerge([makeM('full', 0.9), makeM('partial', 0.3)]);
      expect(result.isOk()).toBe(true);
      expect(typeof result.value.attributesFromEach).toBe('object');
    });

    it('returns err for single-member cluster', () => {
      const result = inspector.suggestMerge([makeM('only', 0.8)]);
      expect(result.isErr()).toBe(true);
    });
  });

  // ── approveMerge ──────────────────────────────────────────────────────────

  describe('approveMerge', () => {
    it('writes decision and returns record', async () => {
      sql
        .mockResolvedValueOnce([{ confidence_score: 0.91 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await inspector.approveMerge('e1', 'e2', 'e1', 'user1', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.mergeStatus).toBe('approved');
      expect(result.value.reviewedByUserId).toBe('user1');
    });

    it('defaults confidence to 0.85 when no prior decision', async () => {
      sql
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await inspector.approveMerge('e1', 'e2', 'e1', 'user1', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.confidenceScore).toBe(0.85);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('insert failed'));
      const result = await inspector.approveMerge('e1', 'e2', 'e1', 'user1', 'ws1');
      expect(result.isErr()).toBe(true);
    });
  });

  // ── explainDedupDecision ──────────────────────────────────────────────────

  describe('explainDedupDecision', () => {
    it('returns explanation with driving attributes', async () => {
      sql.mockResolvedValue([
        {
          entity_id: 'e1',
          attributes_json: JSON.stringify({ name: 'Alice', email: 'a@b.com' }),
          similarity_score: 0.9,
          attributes_compared_json: '["name","email"]',
        },
        {
          entity_id: 'e2',
          attributes_json: JSON.stringify({ name: 'Alice', email: 'a@b.com', phone: '555' }),
          similarity_score: 0.9,
          attributes_compared_json: '["name","email"]',
        },
      ]);

      const result = await inspector.explainDedupDecision('e1', 'e2', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.similarityScore).toBe(0.9);
      expect(result.value.recommendation).toBe('merge');
      expect(result.value.drivingAttributes.length).toBeGreaterThan(0);
    });

    it('recommends keep_separate when similarity below 0.85', async () => {
      sql.mockResolvedValue([
        {
          entity_id: 'e1',
          attributes_json: JSON.stringify({ name: 'Alice' }),
          similarity_score: 0.7,
          attributes_compared_json: '[]',
        },
        {
          entity_id: 'e2',
          attributes_json: JSON.stringify({ name: 'Bob' }),
          similarity_score: 0.7,
          attributes_compared_json: '[]',
        },
      ]);

      const result = await inspector.explainDedupDecision('e1', 'e2', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.recommendation).toBe('keep_separate');
    });

    it('returns err when no entity data found', async () => {
      sql.mockResolvedValue([]);
      const result = await inspector.explainDedupDecision('e1', 'e2', 'ws1');
      expect(result.isErr()).toBe(true);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('db error'));
      const result = await inspector.explainDedupDecision('e1', 'e2', 'ws1');
      expect(result.isErr()).toBe(true);
    });
  });
});
