import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';
import type { SemanticEntity } from '@iris/connector-sdk';

const log = logger.child({ service: 'data-quality-scorer' });

const STALE_DAYS_THRESHOLD = 30;
const LOW_QUALITY_THRESHOLD = 0.5;

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type QualityIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
};

export type QualityScore = {
  entityId: string;
  workspaceId: string;
  entityType: string;
  completenessScore: number;
  freshnessScore: number;
  conformanceScore: number;
  relationshipScore: number;
  overallQualityScore: number;
  issues: QualityIssue[];
  computedAt: Date;
};

export type QualityReport = {
  workspaceId: string;
  totalEntities: number;
  averageQualityScore: number;
  lowQualityCount: number;
  issues: { entityId: string; issues: QualityIssue[] }[];
  distributionBuckets: { bucket: string; count: number }[];
};

export type RequiredFields = Record<string, string[]>;

// ─── DataQualityScorer ────────────────────────────────────────────────────────

/**
 * Computes multi-dimensional quality scores for indexed entities.
 * Scores completeness, freshness, schema conformance, and relationship validity.
 */
export class DataQualityScorer {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Score a batch of entities and persist results to entity_quality_metrics.
   *
   * @param entities - Entities to score
   * @param workspaceId - Tenant workspace
   * @param requiredFields - Per entity-type required attribute names
   * @param existingEntityIds - Set of known entity IDs for relationship validation
   */
  async scoreAndPersist(
    entities: SemanticEntity[],
    workspaceId: string,
    requiredFields: RequiredFields = {},
    existingEntityIds: Set<string> = new Set(),
  ): Promise<Result<QualityScore[], Error>> {
    try {
      const scores: QualityScore[] = [];

      for (const entity of entities) {
        const score = this.computeScore(entity, workspaceId, requiredFields, existingEntityIds);
        scores.push(score);

        await this.sql`
          INSERT INTO entity_quality_metrics (
            entity_id, workspace_id, entity_type,
            completeness_score, freshness_score, conformance_score,
            relationship_score, overall_quality_score, issues, computed_at
          ) VALUES (
            ${score.entityId}, ${score.workspaceId}, ${score.entityType},
            ${score.completenessScore}, ${score.freshnessScore}, ${score.conformanceScore},
            ${score.relationshipScore}, ${score.overallQualityScore},
            ${JSON.stringify(score.issues)}, now()
          )
          ON CONFLICT (entity_id, workspace_id) DO UPDATE SET
            entity_type = EXCLUDED.entity_type,
            completeness_score = EXCLUDED.completeness_score,
            freshness_score = EXCLUDED.freshness_score,
            conformance_score = EXCLUDED.conformance_score,
            relationship_score = EXCLUDED.relationship_score,
            overall_quality_score = EXCLUDED.overall_quality_score,
            issues = EXCLUDED.issues,
            computed_at = now()
        `;
      }

      log.info('Entity quality scoring complete', {
        workspaceId,
        scored: scores.length,
        averageScore: scores.length > 0
          ? scores.reduce((s, e) => s + e.overallQualityScore, 0) / scores.length
          : 0,
      });

      return ok(scores);
    } catch (e) {
      log.error('Failed to score entities', { workspaceId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compute a quality score for a single entity without persisting.
   *
   * @param entity - Entity to score
   * @param workspaceId - Tenant workspace
   * @param requiredFields - Per entity-type required attribute names
   * @param existingEntityIds - Set of known entity IDs for relationship validation
   */
  computeScore(
    entity: SemanticEntity,
    workspaceId: string,
    requiredFields: RequiredFields = {},
    existingEntityIds: Set<string> = new Set(),
  ): QualityScore {
    const issues: QualityIssue[] = [];

    const completenessScore = this.scoreCompleteness(entity, issues);
    const freshnessScore = this.scoreFreshness(entity, issues);
    const conformanceScore = this.scoreConformance(entity, requiredFields, issues);
    const relationshipScore = this.scoreRelationships(entity, existingEntityIds, issues);

    const overallQualityScore = (
      completenessScore * 0.35 +
      freshnessScore * 0.2 +
      conformanceScore * 0.3 +
      relationshipScore * 0.15
    );

    return {
      entityId: entity.id,
      workspaceId,
      entityType: entity.type,
      completenessScore,
      freshnessScore,
      conformanceScore,
      relationshipScore,
      overallQualityScore,
      issues,
      computedAt: new Date(),
    };
  }

  /**
   * Retrieve quality report for a workspace from persisted metrics.
   *
   * @param workspaceId - Tenant workspace
   * @param entityType - Optional filter by entity type
   * @param limit - Maximum issues to return (default 50)
   */
  async getReport(
    workspaceId: string,
    entityType?: string,
    limit = 50,
  ): Promise<Result<QualityReport, Error>> {
    try {
      const rows = entityType
        ? await this.sql`
            SELECT entity_id, entity_type, overall_quality_score, issues
            FROM entity_quality_metrics
            WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
            ORDER BY overall_quality_score ASC
          ` as { entity_id: string; entity_type: string; overall_quality_score: number; issues: unknown }[]
        : await this.sql`
            SELECT entity_id, entity_type, overall_quality_score, issues
            FROM entity_quality_metrics
            WHERE workspace_id = ${workspaceId}
            ORDER BY overall_quality_score ASC
          ` as { entity_id: string; entity_type: string; overall_quality_score: number; issues: unknown }[];

      const total = rows.length;
      const avgScore = total > 0
        ? rows.reduce((s, r) => s + r.overall_quality_score, 0) / total
        : 0;
      const lowQuality = rows.filter((r) => r.overall_quality_score < LOW_QUALITY_THRESHOLD).length;

      const issues = rows
        .filter((r) => (r.issues as QualityIssue[]).length > 0)
        .slice(0, limit)
        .map((r) => ({ entityId: r.entity_id, issues: r.issues as QualityIssue[] }));

      const distribution = this.computeDistribution(rows.map((r) => r.overall_quality_score));

      return ok({
        workspaceId,
        totalEntities: total,
        averageQualityScore: avgScore,
        lowQualityCount: lowQuality,
        issues,
        distributionBuckets: distribution,
      });
    } catch (e) {
      log.error('Failed to retrieve quality report', { workspaceId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Private scoring methods ──────────────────────────────────────────────

  private scoreCompleteness(entity: SemanticEntity, issues: QualityIssue[]): number {
    const attrs = entity.attributes;
    const total = Object.keys(attrs).length;
    if (total === 0) {
      issues.push({ code: 'NO_ATTRIBUTES', severity: 'error', message: 'Entity has no attributes' });
      return 0;
    }
    const nonNull = Object.values(attrs).filter(
      (v) => v !== null && v !== undefined && v !== '',
    ).length;
    const score = nonNull / total;
    if (score < 0.5) {
      issues.push({
        code: 'LOW_COMPLETENESS',
        severity: 'warning',
        message: `Only ${Math.round(score * 100)}% of attributes are populated`,
      });
    }
    if (!entity.label || entity.label.trim() === '') {
      issues.push({ code: 'MISSING_LABEL', severity: 'error', message: 'Entity label is empty' });
      return score * 0.5;
    }
    return score;
  }

  private scoreFreshness(entity: SemanticEntity, issues: QualityIssue[]): number {
    const now = Date.now();
    const ageMs = now - entity.lastModified.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays > STALE_DAYS_THRESHOLD * 3) {
      issues.push({
        code: 'STALE_DATA',
        severity: 'error',
        message: `Entity not updated in ${Math.round(ageDays)} days`,
      });
      return 0.1;
    }
    if (ageDays > STALE_DAYS_THRESHOLD) {
      issues.push({
        code: 'AGING_DATA',
        severity: 'warning',
        message: `Entity not updated in ${Math.round(ageDays)} days`,
      });
      return 0.5;
    }
    // Linear decay from 1.0 at 0 days to 0.5 at STALE_DAYS_THRESHOLD days
    return Math.max(0.5, 1 - (ageDays / (STALE_DAYS_THRESHOLD * 2)));
  }

  private scoreConformance(
    entity: SemanticEntity,
    requiredFields: RequiredFields,
    issues: QualityIssue[],
  ): number {
    const required = requiredFields[entity.type] ?? [];
    if (required.length === 0) return 1;

    const missing = required.filter(
      (field) => entity.attributes[field] === null || entity.attributes[field] === undefined,
    );

    if (missing.length > 0) {
      issues.push({
        code: 'MISSING_REQUIRED_FIELDS',
        severity: 'error',
        message: `Missing required fields: ${missing.join(', ')}`,
      });
    }
    return (required.length - missing.length) / required.length;
  }

  private scoreRelationships(
    entity: SemanticEntity,
    existingEntityIds: Set<string>,
    issues: QualityIssue[],
  ): number {
    if (entity.relationships.length === 0) return 1;
    if (existingEntityIds.size === 0) return 1;

    const broken = entity.relationships.filter(
      (r) => !existingEntityIds.has(r.targetId),
    );

    if (broken.length > 0) {
      issues.push({
        code: 'BROKEN_RELATIONSHIPS',
        severity: 'warning',
        message: `${broken.length} relationship(s) point to non-existent entities`,
      });
    }
    return (entity.relationships.length - broken.length) / entity.relationships.length;
  }

  private computeDistribution(scores: number[]): { bucket: string; count: number }[] {
    const buckets = [
      { label: '0.0–0.2', min: 0, max: 0.2 },
      { label: '0.2–0.4', min: 0.2, max: 0.4 },
      { label: '0.4–0.6', min: 0.4, max: 0.6 },
      { label: '0.6–0.8', min: 0.6, max: 0.8 },
      { label: '0.8–1.0', min: 0.8, max: 1.01 },
    ];
    return buckets.map(({ label, min, max }) => ({
      bucket: label,
      count: scores.filter((s) => s >= min && s < max).length,
    }));
  }
}
