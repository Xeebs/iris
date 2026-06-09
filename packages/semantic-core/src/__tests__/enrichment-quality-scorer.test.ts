import { describe, it, expect, vi } from 'vitest';
import { EnrichmentQualityScorer } from '../enrichment-quality-scorer';

function makeSql(overrides: Record<string, unknown> = {}) {
  return vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const q = strings.join('').toLowerCase();
    for (const [pattern, result] of Object.entries(overrides)) {
      if (q.includes(pattern.toLowerCase())) return Promise.resolve(result);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres')>;
}

const WS = 'ws-test';
const CONNECTOR = 'clearbit';
const ENTITY_ID = 'contact:001';

describe('EnrichmentQualityScorer', () => {
  describe('scoreEnrichmentCompletenessForEntity', () => {
    it('returns NOT_FOUND when no score record exists', async () => {
      const sql = makeSql({});
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.scoreEnrichmentCompletenessForEntity(ENTITY_ID, WS);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('NOT_FOUND');
    });

    it('returns completeness score for known entity', async () => {
      const sql = makeSql({
        'enrichment_quality_scores': [{
          entity_id: ENTITY_ID,
          entity_type: 'contact',
          connector_id: CONNECTOR,
          completeness: 75,
          required_hit_rate: 0.9,
          source_diversity: 0.7,
          scored_at: new Date(),
        }],
      });
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.scoreEnrichmentCompletenessForEntity(ENTITY_ID, WS);

      expect(result.isOk()).toBe(true);
      const score = result._unsafeUnwrap();
      expect(score.completeness).toBe(75);
      expect(score.entityId).toBe(ENTITY_ID);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('DB fail')) as unknown as ReturnType<typeof import('postgres')>;
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.scoreEnrichmentCompletenessForEntity(ENTITY_ID, WS);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('DB_ERROR');
    });
  });

  describe('aggregateEnrichmentMetrics', () => {
    it('returns empty array when no data', async () => {
      const sql = makeSql({});
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.aggregateEnrichmentMetrics(CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('aggregates metrics per entity type', async () => {
      const sql = makeSql({
        'enrichment_quality_scores': [
          { entity_type: 'contact', mean_completeness: 72, mean_diversity: 0.6, mean_refresh_lag: 3600, entity_count: 50 },
          { entity_type: 'company', mean_completeness: 85, mean_diversity: 0.8, mean_refresh_lag: 7200, entity_count: 20 },
        ],
      });
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.aggregateEnrichmentMetrics(CONNECTOR, WS, 'P7D');

      expect(result.isOk()).toBe(true);
      const metrics = result._unsafeUnwrap();
      expect(metrics.length).toBe(2);
      expect(metrics[0]).toHaveProperty('entityType');
      expect(metrics[0]).toHaveProperty('meanCompleteness');
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.aggregateEnrichmentMetrics(CONNECTOR, WS);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('detectEnrichmentGaps', () => {
    it('returns gaps with high null rates', async () => {
      const sql = makeSql({
        'enrichment_gaps': [
          { field_name: 'company_size', null_rate: 0.9, null_count: 90, total_count: 100 },
          { field_name: 'industry', null_rate: 0.7, null_count: 70, total_count: 100 },
        ],
      });
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.detectEnrichmentGaps('contact', CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      const gaps = result._unsafeUnwrap();
      expect(gaps.length).toBe(2);
      expect(gaps[0]!.fieldName).toBe('company_size');
      expect(gaps[0]!.nullRate).toBeCloseTo(0.9);
    });

    it('returns empty array when no gaps', async () => {
      const sql = makeSql({});
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.detectEnrichmentGaps('contact', CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.detectEnrichmentGaps('contact', CONNECTOR, WS);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('scoreSourceDiversity', () => {
    it('returns zero entropy for entity with no sources', async () => {
      const sql = makeSql({});
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.scoreSourceDiversity(ENTITY_ID, WS);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().entropy).toBe(0);
      expect(result._unsafeUnwrap().sourceCount).toBe(0);
    });

    it('returns higher entropy for more diverse sources', async () => {
      const sql = makeSql({
        'entity_enrichment_sources': [
          { source_id: 'clearbit', attribute_count: 5 },
          { source_id: 'linkedin', attribute_count: 5 },
          { source_id: 'crunchbase', attribute_count: 5 },
        ],
      });
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.scoreSourceDiversity(ENTITY_ID, WS);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().entropy).toBeGreaterThan(0.5);
      expect(result._unsafeUnwrap().sourceCount).toBe(3);
    });

    it('returns lower entropy for concentrated source', async () => {
      const sql = makeSql({
        'entity_enrichment_sources': [
          { source_id: 'clearbit', attribute_count: 9 },
          { source_id: 'linkedin', attribute_count: 1 },
        ],
      });
      const scorer = new EnrichmentQualityScorer(sql);

      const multi = await scorer.scoreSourceDiversity(ENTITY_ID, WS);

      const sqlConc = makeSql({
        'entity_enrichment_sources': [
          { source_id: 'clearbit', attribute_count: 10 },
        ],
      });
      const scorerConc = new EnrichmentQualityScorer(sqlConc);
      const single = await scorerConc.scoreSourceDiversity(ENTITY_ID, WS);

      expect(multi.isOk()).toBe(true);
      expect(single.isOk()).toBe(true);
      // More sources, even uneven, generally = higher entropy than single source
      expect(multi._unsafeUnwrap().entropy).toBeGreaterThanOrEqual(single._unsafeUnwrap().entropy);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.scoreSourceDiversity(ENTITY_ID, WS);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('assessEnrichmentROI', () => {
    it('returns zero ROI with no enrichment history', async () => {
      const sql = makeSql({});
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.assessEnrichmentROI(CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      const roi = result._unsafeUnwrap();
      expect(roi.totalTokenCost).toBe(0);
      expect(roi.entitiesEnriched).toBe(0);
    });

    it('computes token efficiency metrics', async () => {
      const sql = makeSql({
        'enrichment_audit_log': [{ total_tokens: 10000, entity_count: 100 }],
        'avg_gain': [{ avg_gain: 15 }],
      });
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.assessEnrichmentROI(CONNECTOR, WS, 'P7D');

      expect(result.isOk()).toBe(true);
      const roi = result._unsafeUnwrap();
      expect(roi.connectorId).toBe(CONNECTOR);
    });

    it('returns DB error on failure', async () => {
      const sql = vi.fn().mockRejectedValue(new Error('fail')) as unknown as ReturnType<typeof import('postgres')>;
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.assessEnrichmentROI(CONNECTOR, WS);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('recordSourceFeedback', () => {
    it('validates accuracy rating range', async () => {
      const sql = makeSql({});
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.recordSourceFeedback('clearbit', WS, 'contact', 1.5);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('VALIDATION_ERROR');
    });

    it('inserts feedback for valid rating', async () => {
      const sql = makeSql({});
      const scorer = new EnrichmentQualityScorer(sql);

      const result = await scorer.recordSourceFeedback('clearbit', WS, 'contact', 0.9);

      expect(result.isOk()).toBe(true);
    });
  });
});
