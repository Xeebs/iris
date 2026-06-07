import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataQualityScorer } from '../data-quality-scorer.js';
import type { SemanticEntity } from '@iris/connector-sdk';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'hubspot:contact:1',
    type: 'contact',
    label: 'Alice Smith',
    attributes: {
      email: 'alice@test.com',
      company: 'Acme Inc',
      phone: null,
      stage: 'customer',
    },
    relationships: [],
    lastModified: new Date(),
    sourceId: 'hubspot:contact:1',
    ...overrides,
  };
}

const noopSql = vi.fn(async () => []);

describe('DataQualityScorer', () => {
  let scorer: DataQualityScorer;

  beforeEach(() => {
    vi.clearAllMocks();
    scorer = new DataQualityScorer(noopSql as unknown as Parameters<typeof DataQualityScorer>[0]);
  });

  describe('computeScore — completeness', () => {
    it('returns high completeness when most attributes are populated', () => {
      const entity = makeEntity();
      const score = scorer.computeScore(entity, 'ws-1');
      expect(score.completenessScore).toBeGreaterThan(0.5); // 3/4 non-null = 0.75
    });

    it('adds NO_ATTRIBUTES issue when entity has no attributes', () => {
      const entity = makeEntity({ attributes: {} });
      const score = scorer.computeScore(entity, 'ws-1');
      expect(score.completenessScore).toBe(0);
      expect(score.issues.some((i) => i.code === 'NO_ATTRIBUTES')).toBe(true);
    });

    it('adds MISSING_LABEL issue for empty label', () => {
      const entity = makeEntity({ label: '' });
      const score = scorer.computeScore(entity, 'ws-1');
      expect(score.issues.some((i) => i.code === 'MISSING_LABEL')).toBe(true);
      expect(score.completenessScore).toBeLessThan(0.5);
    });

    it('adds LOW_COMPLETENESS warning when < 50% populated', () => {
      const entity = makeEntity({
        attributes: { a: null, b: null, c: null, d: 'value' },
      });
      const score = scorer.computeScore(entity, 'ws-1');
      expect(score.issues.some((i) => i.code === 'LOW_COMPLETENESS')).toBe(true);
    });
  });

  describe('computeScore — freshness', () => {
    it('returns high score for recently modified entity', () => {
      const entity = makeEntity({ lastModified: new Date() });
      const score = scorer.computeScore(entity, 'ws-1');
      expect(score.freshnessScore).toBeGreaterThan(0.9);
    });

    it('returns 0.5 for entity modified between 30 and 90 days ago', () => {
      const d = new Date();
      d.setDate(d.getDate() - 45);
      const entity = makeEntity({ lastModified: d });
      const score = scorer.computeScore(entity, 'ws-1');
      expect(score.freshnessScore).toBe(0.5);
      expect(score.issues.some((i) => i.code === 'AGING_DATA')).toBe(true);
    });

    it('returns 0.1 for entity modified more than 90 days ago', () => {
      const d = new Date();
      d.setDate(d.getDate() - 120);
      const entity = makeEntity({ lastModified: d });
      const score = scorer.computeScore(entity, 'ws-1');
      expect(score.freshnessScore).toBe(0.1);
      expect(score.issues.some((i) => i.code === 'STALE_DATA')).toBe(true);
    });
  });

  describe('computeScore — conformance', () => {
    it('returns 1.0 when no required fields defined for type', () => {
      const score = scorer.computeScore(makeEntity(), 'ws-1', {});
      expect(score.conformanceScore).toBe(1);
    });

    it('returns 1.0 when all required fields are present', () => {
      const score = scorer.computeScore(makeEntity(), 'ws-1', {
        contact: ['email', 'company'],
      });
      expect(score.conformanceScore).toBe(1);
    });

    it('returns partial score and adds issue when required fields missing', () => {
      const entity = makeEntity({ attributes: { email: 'alice@test.com' } });
      const score = scorer.computeScore(entity, 'ws-1', {
        contact: ['email', 'company', 'phone'],
      });
      expect(score.conformanceScore).toBeCloseTo(1 / 3);
      expect(score.issues.some((i) => i.code === 'MISSING_REQUIRED_FIELDS')).toBe(true);
    });
  });

  describe('computeScore — relationships', () => {
    it('returns 1.0 when entity has no relationships', () => {
      const score = scorer.computeScore(makeEntity({ relationships: [] }), 'ws-1');
      expect(score.relationshipScore).toBe(1);
    });

    it('returns 1.0 when existingEntityIds set is empty (cannot verify)', () => {
      const entity = makeEntity({
        relationships: [{ type: 'belongs_to', targetId: 'hubspot:company:1' }],
      });
      const score = scorer.computeScore(entity, 'ws-1', {}, new Set());
      expect(score.relationshipScore).toBe(1);
    });

    it('returns 1.0 when all referenced entities exist', () => {
      const entity = makeEntity({
        relationships: [{ type: 'belongs_to', targetId: 'hubspot:company:1' }],
      });
      const existing = new Set(['hubspot:company:1']);
      const score = scorer.computeScore(entity, 'ws-1', {}, existing);
      expect(score.relationshipScore).toBe(1);
    });

    it('deducts score and adds issue for broken relationships', () => {
      const entity = makeEntity({
        relationships: [
          { type: 'belongs_to', targetId: 'hubspot:company:MISSING' },
          { type: 'owned_by', targetId: 'hubspot:user:1' },
        ],
      });
      const existing = new Set(['hubspot:user:1']);
      const score = scorer.computeScore(entity, 'ws-1', {}, existing);
      expect(score.relationshipScore).toBe(0.5);
      expect(score.issues.some((i) => i.code === 'BROKEN_RELATIONSHIPS')).toBe(true);
    });
  });

  describe('computeScore — overall', () => {
    it('overall score is weighted average of dimension scores', () => {
      const entity = makeEntity();
      const score = scorer.computeScore(entity, 'ws-1');
      const expected =
        score.completenessScore * 0.35 +
        score.freshnessScore * 0.2 +
        score.conformanceScore * 0.3 +
        score.relationshipScore * 0.15;
      expect(score.overallQualityScore).toBeCloseTo(expected, 5);
    });
  });

  describe('scoreAndPersist', () => {
    it('persists scores and returns ok result', async () => {
      const sql = vi.fn(async () => []);
      const s = new DataQualityScorer(sql as unknown as Parameters<typeof DataQualityScorer>[0]);
      const entities = [makeEntity(), makeEntity({ id: 'e2', sourceId: 'e2' })];
      const result = await s.scoreAndPersist(entities, 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
      expect(sql).toHaveBeenCalledTimes(2);
    });

    it('returns err when sql throws', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('DB failure'));
      const s = new DataQualityScorer(sql as unknown as Parameters<typeof DataQualityScorer>[0]);
      const result = await s.scoreAndPersist([makeEntity()], 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getReport', () => {
    it('returns report with correct aggregations', async () => {
      const rows = [
        { entity_id: 'e1', entity_type: 'contact', overall_quality_score: 0.3, issues: [{ code: 'STALE_DATA', severity: 'error', message: 'stale' }] },
        { entity_id: 'e2', entity_type: 'contact', overall_quality_score: 0.8, issues: [] },
        { entity_id: 'e3', entity_type: 'company', overall_quality_score: 0.9, issues: [] },
      ];
      const sql = vi.fn(async () => rows);
      const s = new DataQualityScorer(sql as unknown as Parameters<typeof DataQualityScorer>[0]);

      const result = await s.getReport('ws-1');
      expect(result.isOk()).toBe(true);
      const report = result._unsafeUnwrap();
      expect(report.totalEntities).toBe(3);
      expect(report.averageQualityScore).toBeCloseTo((0.3 + 0.8 + 0.9) / 3);
      expect(report.lowQualityCount).toBe(1);
      expect(report.issues).toHaveLength(1);
      expect(report.distributionBuckets).toHaveLength(5);
    });

    it('returns empty report when no metrics exist', async () => {
      const sql = vi.fn(async () => []);
      const s = new DataQualityScorer(sql as unknown as Parameters<typeof DataQualityScorer>[0]);
      const result = await s.getReport('ws-1');
      expect(result.isOk()).toBe(true);
      const report = result._unsafeUnwrap();
      expect(report.totalEntities).toBe(0);
      expect(report.averageQualityScore).toBe(0);
    });

    it('returns err when sql throws', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('Query failed'));
      const s = new DataQualityScorer(sql as unknown as Parameters<typeof DataQualityScorer>[0]);
      const result = await s.getReport('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });
});
