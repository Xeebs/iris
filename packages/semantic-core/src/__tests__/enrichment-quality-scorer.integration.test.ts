import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { EnrichmentQualityScorer } from '../enrichment-quality-scorer';

/**
 * Integration tests for EnrichmentQualityScorer — require Postgres with migration 150 applied.
 * Run with: pnpm test:integration --filter=semantic-core
 */

let sql: ReturnType<typeof postgres>;
let scorer: EnrichmentQualityScorer;

const WS = 'test-workspace-enrichment';
const CONNECTOR = 'clearbit-test';

beforeAll(async () => {
  sql = postgres(process.env['DATABASE_URL'] ?? 'postgresql://iris:iris@localhost:5432/iris_test');
  scorer = new EnrichmentQualityScorer(sql);

  // Seed quality scores
  await sql`
    INSERT INTO enrichment_quality_scores
      (entity_id, entity_type, connector_id, workspace_id, completeness, required_hit_rate, source_diversity, refresh_lag_sec, scored_at)
    VALUES
      ('clearbit:contact:001', 'contact', ${CONNECTOR}, ${WS}, 85.0, 0.9, 0.7, 3600, NOW()),
      ('clearbit:contact:002', 'contact', ${CONNECTOR}, ${WS}, 60.0, 0.8, 0.5, 7200, NOW()),
      ('clearbit:company:001', 'company', ${CONNECTOR}, ${WS}, 92.0, 1.0, 0.9, 1800, NOW())
    ON CONFLICT (entity_id, workspace_id) DO NOTHING
  `;

  // Seed gaps
  await sql`
    INSERT INTO enrichment_gaps
      (workspace_id, connector_id, entity_type, field_name, null_count, total_count, null_rate)
    VALUES
      (${WS}, ${CONNECTOR}, 'contact', 'company_size', 80, 100, 0.8),
      (${WS}, ${CONNECTOR}, 'contact', 'phone_number', 60, 100, 0.6)
    ON CONFLICT (workspace_id, connector_id, entity_type, field_name) DO NOTHING
  `;
});

afterAll(async () => {
  await sql`DELETE FROM enrichment_quality_scores WHERE workspace_id = ${WS}`;
  await sql`DELETE FROM enrichment_gaps WHERE workspace_id = ${WS}`;
  await sql`DELETE FROM source_reliability_feedback WHERE workspace_id = ${WS}`;
  await sql.end();
});

describe('EnrichmentQualityScorer (integration)', () => {
  describe('scoreEnrichmentCompletenessForEntity', () => {
    it('retrieves completeness from DB', async () => {
      const result = await scorer.scoreEnrichmentCompletenessForEntity('clearbit:contact:001', WS);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().completeness).toBeCloseTo(85, 0);
    });

    it('returns NOT_FOUND for missing entity', async () => {
      const result = await scorer.scoreEnrichmentCompletenessForEntity('nonexistent', WS);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('NOT_FOUND');
    });
  });

  describe('aggregateEnrichmentMetrics', () => {
    it('returns metrics grouped by entity type', async () => {
      const result = await scorer.aggregateEnrichmentMetrics(CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      const metrics = result._unsafeUnwrap();
      expect(metrics.length).toBeGreaterThan(0);
      const contactMetric = metrics.find((m) => m.entityType === 'contact');
      expect(contactMetric).toBeDefined();
      expect(contactMetric!.meanCompleteness).toBeGreaterThan(0);
    });
  });

  describe('detectEnrichmentGaps', () => {
    it('returns gaps above threshold', async () => {
      const result = await scorer.detectEnrichmentGaps('contact', CONNECTOR, WS, 0.5);

      expect(result.isOk()).toBe(true);
      const gaps = result._unsafeUnwrap();
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps[0]!.nullRate).toBeGreaterThanOrEqual(0.5);
    });

    it('returns gaps ordered by null_rate descending', async () => {
      const result = await scorer.detectEnrichmentGaps('contact', CONNECTOR, WS, 0.0);

      expect(result.isOk()).toBe(true);
      const gaps = result._unsafeUnwrap();
      for (let i = 1; i < gaps.length; i++) {
        expect(gaps[i - 1]!.nullRate).toBeGreaterThanOrEqual(gaps[i]!.nullRate);
      }
    });
  });

  describe('recordSourceFeedback + getSourceReliability', () => {
    it('persists feedback and retrieves rolling average', async () => {
      await scorer.recordSourceFeedback('clearbit-test', WS, 'contact', 0.85);
      await scorer.recordSourceFeedback('clearbit-test', WS, 'contact', 0.95);

      const result = await scorer.getSourceReliability('clearbit-test', WS);

      expect(result.isOk()).toBe(true);
      const recs = result._unsafeUnwrap();
      const contactRec = recs.find((r) => r.entityType === 'contact');
      expect(contactRec).toBeDefined();
      expect(contactRec!.feedbackCount).toBe(2);
      expect(contactRec!.accuracyRating).toBeGreaterThan(0.8);
    });
  });

  describe('assessEnrichmentROI', () => {
    it('returns zero ROI with no enrichment audit log', async () => {
      const result = await scorer.assessEnrichmentROI(CONNECTOR, WS);

      expect(result.isOk()).toBe(true);
      const roi = result._unsafeUnwrap();
      expect(roi.entitiesEnriched).toBe(0);
      expect(roi.totalTokenCost).toBe(0);
    });
  });
});
