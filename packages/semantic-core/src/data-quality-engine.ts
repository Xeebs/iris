import { logger } from '@iris/core/logger';
import type { SemanticEntity } from '@iris/connector-sdk';

const log = logger.child({ service: 'data-quality-engine' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type QualityWeights = {
  completeness: number;
  freshness: number;
  accuracy: number;
};

const DEFAULT_WEIGHTS: QualityWeights = { completeness: 0.4, freshness: 0.35, accuracy: 0.25 };

export type EntityQualityScore = {
  entityId: string;
  entityType: string;
  completenessScore: number;
  freshnessScore: number;
  accuracyScore: number;
  overallScore: number;
};

export type EntityTypeScore = {
  entityType: string;
  entityCount: number;
  avgCompletenessScore: number;
  avgFreshnessScore: number;
  avgAccuracyScore: number;
  avgOverallScore: number;
};

export type WorkspaceQualityScore = {
  workspaceId: string;
  overallScore: number;
  entityTypeScores: EntityTypeScore[];
  assessedAt: Date;
};

export type IssueType = 'duplicates' | 'stale' | 'invalid' | 'missing_relationship';
export type IssueSeverity = 'low' | 'medium' | 'high';

export type QualityIssue = {
  issueId: string;
  issueType: IssueType;
  entityType: string;
  affectedCount: number;
  severity: IssueSeverity;
  description: string;
  firstDetectedAt: Date;
};

export type RemediationAction = {
  issueId: string;
  actionType: string;
  description: string;
  estimatedImpact: string;
  status: 'pending' | 'approved' | 'applied';
};

// ─── Scoring helpers ──────────────────────────────────────────────────────────

const STALE_THRESHOLD_DAYS = 90;

function computeCompletenessScore(entity: SemanticEntity): number {
  const attrs = entity.attributes;
  const keys = Object.keys(attrs);
  if (keys.length === 0) return 0;
  const nonNull = keys.filter((k) => attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== '').length;
  return nonNull / keys.length;
}

function computeFreshnessScore(entity: SemanticEntity): number {
  const lastMod = entity.lastModified;
  if (!lastMod) return 0.5;
  const ageMs = Date.now() - new Date(lastMod).getTime();
  const ageDays = ageMs / 86_400_000;
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.8;
  if (ageDays <= 90) return 0.5;
  return Math.max(0, 1 - ageDays / (STALE_THRESHOLD_DAYS * 2));
}

function computeAccuracyScore(entity: SemanticEntity): number {
  const attrs = entity.attributes;
  let issues = 0;
  let checks = 0;

  for (const [, val] of Object.entries(attrs)) {
    checks++;
    if (typeof val === 'string' && val.trim() === '') issues++;
    if (typeof val === 'number' && (isNaN(val) || !isFinite(val))) issues++;
  }

  if (checks === 0) return 1;
  return (checks - issues) / checks;
}

function computeEntityScore(entity: SemanticEntity, weights: QualityWeights): EntityQualityScore {
  const completeness = computeCompletenessScore(entity);
  const freshness = computeFreshnessScore(entity);
  const accuracy = computeAccuracyScore(entity);
  const overall = completeness * weights.completeness + freshness * weights.freshness + accuracy * weights.accuracy;

  return {
    entityId: entity.id,
    entityType: entity.type,
    completenessScore: Math.round(completeness * 100) / 100,
    freshnessScore: Math.round(freshness * 100) / 100,
    accuracyScore: Math.round(accuracy * 100) / 100,
    overallScore: Math.round(overall * 100),
  };
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── DataQualityEngine ────────────────────────────────────────────────────────

export class DataQualityEngine {
  private readonly weights: QualityWeights;

  constructor(weights: QualityWeights = DEFAULT_WEIGHTS) {
    this.weights = weights;
  }

  /**
   * Score a single entity against its field schema.
   * @param entity - Entity to score
   * @returns EntityQualityScore
   */
  scoreEntity(entity: SemanticEntity): EntityQualityScore {
    return computeEntityScore(entity, this.weights);
  }

  /**
   * Aggregate scores for all entities of a given type.
   * @param entityType - Entity type label
   * @param entities - Entities of that type
   * @returns EntityTypeScore
   */
  scoreEntityType(entityType: string, entities: SemanticEntity[]): EntityTypeScore {
    if (entities.length === 0) {
      return { entityType, entityCount: 0, avgCompletenessScore: 0, avgFreshnessScore: 0, avgAccuracyScore: 0, avgOverallScore: 0 };
    }

    const scores = entities.map((e) => computeEntityScore(e, this.weights));
    return {
      entityType,
      entityCount: entities.length,
      avgCompletenessScore: Math.round(avg(scores.map((s) => s.completenessScore)) * 100) / 100,
      avgFreshnessScore: Math.round(avg(scores.map((s) => s.freshnessScore)) * 100) / 100,
      avgAccuracyScore: Math.round(avg(scores.map((s) => s.accuracyScore)) * 100) / 100,
      avgOverallScore: Math.round(avg(scores.map((s) => s.overallScore))),
    };
  }

  /**
   * Roll up quality scores across all entity types for a workspace.
   * @param workspaceId - Workspace scope
   * @param entityMap - Map of entityType → entities
   * @returns WorkspaceQualityScore
   */
  scoreWorkspace(workspaceId: string, entityMap: Map<string, SemanticEntity[]>): WorkspaceQualityScore {
    const typeScores: EntityTypeScore[] = [];
    let weightedSum = 0;
    let totalEntities = 0;

    for (const [type, entities] of entityMap) {
      const ts = this.scoreEntityType(type, entities);
      typeScores.push(ts);
      weightedSum += ts.avgOverallScore * entities.length;
      totalEntities += entities.length;
    }

    const overallScore = totalEntities > 0 ? Math.round(weightedSum / totalEntities) : 0;
    log.info('Workspace quality assessed', { workspaceId, overallScore, entityTypes: typeScores.length });

    return { workspaceId, overallScore, entityTypeScores: typeScores, assessedAt: new Date() };
  }

  /**
   * Detect quality issues in an entity collection.
   * @param workspaceId - Workspace scope
   * @param entityMap - Map of entityType → entities
   * @returns Array of detected QualityIssue
   */
  detectQualityIssues(workspaceId: string, entityMap: Map<string, SemanticEntity[]>): QualityIssue[] {
    const issues: QualityIssue[] = [];
    let issueCounter = 0;

    for (const [type, entities] of entityMap) {
      const nowMs = Date.now();

      // Check for stale entities (not updated in 90+ days)
      const staleEntities = entities.filter((e) => {
        if (!e.lastModified) return false;
        const ageMs = nowMs - new Date(e.lastModified).getTime();
        return ageMs > STALE_THRESHOLD_DAYS * 86_400_000;
      });

      if (staleEntities.length > 0) {
        issues.push({
          issueId: `${workspaceId}:stale:${type}:${++issueCounter}`,
          issueType: 'stale',
          entityType: type,
          affectedCount: staleEntities.length,
          severity: staleEntities.length > entities.length * 0.5 ? 'high' : staleEntities.length > 10 ? 'medium' : 'low',
          description: `${staleEntities.length} ${type} entities have not been updated in ${STALE_THRESHOLD_DAYS}+ days`,
          firstDetectedAt: new Date(),
        });
      }

      // Check for incomplete entities (< 50% non-null fields)
      const incompleteEntities = entities.filter((e) => computeCompletenessScore(e) < 0.5);
      if (incompleteEntities.length > 0) {
        issues.push({
          issueId: `${workspaceId}:invalid:${type}:${++issueCounter}`,
          issueType: 'invalid',
          entityType: type,
          affectedCount: incompleteEntities.length,
          severity: incompleteEntities.length > entities.length * 0.3 ? 'high' : 'medium',
          description: `${incompleteEntities.length} ${type} entities have less than 50% fields populated`,
          firstDetectedAt: new Date(),
        });
      }

      // Check for duplicate labels
      const labelCounts = new Map<string, number>();
      for (const e of entities) {
        const lbl = e.label.trim().toLowerCase();
        labelCounts.set(lbl, (labelCounts.get(lbl) ?? 0) + 1);
      }
      const duplicateGroups = Array.from(labelCounts.entries()).filter(([, count]) => count > 1);
      const duplicateCount = duplicateGroups.reduce((s, [, c]) => s + (c - 1), 0);

      if (duplicateCount > 0) {
        issues.push({
          issueId: `${workspaceId}:duplicates:${type}:${++issueCounter}`,
          issueType: 'duplicates',
          entityType: type,
          affectedCount: duplicateCount,
          severity: duplicateCount > 50 ? 'high' : duplicateCount > 10 ? 'medium' : 'low',
          description: `${duplicateCount} potential duplicate ${type} entities (same label)`,
          firstDetectedAt: new Date(),
        });
      }

      // Check for missing relationships
      const noRelationships = entities.filter((e) => e.relationships.length === 0);
      if (noRelationships.length > entities.length * 0.4 && noRelationships.length > 5) {
        issues.push({
          issueId: `${workspaceId}:missing_relationship:${type}:${++issueCounter}`,
          issueType: 'missing_relationship',
          entityType: type,
          affectedCount: noRelationships.length,
          severity: 'low',
          description: `${noRelationships.length} ${type} entities have no relationships linked`,
          firstDetectedAt: new Date(),
        });
      }
    }

    log.info('Quality issues detected', { workspaceId, issueCount: issues.length });
    return issues;
  }

  /**
   * Suggest remediation actions for a detected quality issue.
   * @param issue - Quality issue to remediate
   * @returns RemediationAction
   */
  recommendRemediation(issue: QualityIssue): RemediationAction {
    const actionMap: Record<IssueType, { actionType: string; description: string; estimatedImpact: string }> = {
      duplicates: {
        actionType: 'run_dedup',
        description: `Run semantic deduplication to merge ${issue.affectedCount} duplicate ${issue.entityType} entities`,
        estimatedImpact: `Removes ~${issue.affectedCount} redundant entries, improves search accuracy`,
      },
      stale: {
        actionType: 'trigger_sync',
        description: `Trigger a fresh sync to update ${issue.affectedCount} stale ${issue.entityType} entities`,
        estimatedImpact: `Freshness score for ${issue.entityType} rises from current low to ≥0.8`,
      },
      invalid: {
        actionType: 'enrich_entities',
        description: `Request enrichment or re-import for ${issue.affectedCount} incomplete ${issue.entityType} records`,
        estimatedImpact: `Completeness score improves by an estimated ${Math.round(issue.affectedCount / 2)} records`,
      },
      missing_relationship: {
        actionType: 'link_entities',
        description: `Run relationship inference to link ${issue.affectedCount} isolated ${issue.entityType} entities`,
        estimatedImpact: `Relationship coverage increases, improving query relevance`,
      },
    };

    const action = actionMap[issue.issueType];
    return {
      issueId: issue.issueId,
      actionType: action.actionType,
      description: action.description,
      estimatedImpact: action.estimatedImpact,
      status: 'pending',
    };
  }
}
