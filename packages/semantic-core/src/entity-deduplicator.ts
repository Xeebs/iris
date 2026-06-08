import type postgres from 'postgres';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { cosineSimilarity } from './indexer.js';

const log = logger.child({ service: 'entity-deduplicator' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Rule types ────────────────────────────────────────────────────────────────

export type ExactCondition = {
  type: 'exact';
  field: string;
  caseInsensitive?: boolean;
};

export type FuzzyCondition = {
  type: 'fuzzy';
  field: string;
  /** Max Levenshtein distance normalised to string length (0–1). Default: 0.2 */
  maxNormalizedDistance?: number;
};

export type CompositeCondition = {
  type: 'composite';
  operator: 'AND' | 'OR';
  conditions: RuleCondition[];
};

export type RuleCondition = ExactCondition | FuzzyCondition | CompositeCondition;

export type DeduplicationRule = {
  id?: string;
  name: string;
  entityType: string;
  condition: RuleCondition;
  /** Confidence level assigned when this rule fires. Default: 'medium' */
  confidence?: 'high' | 'medium' | 'low';
};

export type DuplicateGroup = {
  canonical: SemanticEntity;
  duplicates: SemanticEntity[];
  ruleIds: string[];
  score: number;
};

export type CandidateScore = {
  score: number;
  embeddingWeight: number;
  ruleWeight: number;
  overlapWeight: number;
  firedRules: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Levenshtein edit distance (case-insensitive). */
function levenshtein(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1 === s2) return 0;
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        s1[i - 1] === s2[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

function attrString(entity: SemanticEntity, field: string): string {
  const v = entity.attributes[field];
  if (v === null || v === undefined) return '';
  return Array.isArray(v) ? v.join(',') : String(v);
}

/**
 * Evaluate a single rule condition against an entity pair.
 */
export function evaluateCondition(
  entity1: SemanticEntity,
  entity2: SemanticEntity,
  condition: RuleCondition,
): boolean {
  switch (condition.type) {
    case 'exact': {
      const v1 = attrString(entity1, condition.field);
      const v2 = attrString(entity2, condition.field);
      if (!v1 || !v2) return false;
      return condition.caseInsensitive !== false
        ? v1.toLowerCase() === v2.toLowerCase()
        : v1 === v2;
    }
    case 'fuzzy': {
      const v1 = attrString(entity1, condition.field);
      const v2 = attrString(entity2, condition.field);
      if (!v1 || !v2) return false;
      const maxLen = Math.max(v1.length, v2.length);
      if (maxLen === 0) return true;
      const dist = levenshtein(v1, v2);
      const threshold = condition.maxNormalizedDistance ?? 0.2;
      return dist / maxLen <= threshold;
    }
    case 'composite': {
      if (condition.operator === 'AND') {
        return condition.conditions.every((c) => evaluateCondition(entity1, entity2, c));
      }
      return condition.conditions.some((c) => evaluateCondition(entity1, entity2, c));
    }
  }
}

/**
 * Attribute value overlap ratio between two entities.
 * Counts matching non-null attribute values across shared keys.
 */
export function attributeOverlapRatio(entity1: SemanticEntity, entity2: SemanticEntity): number {
  const keys1 = new Set(Object.keys(entity1.attributes).filter((k) => entity1.attributes[k] !== null && entity1.attributes[k] !== undefined));
  const keys2 = new Set(Object.keys(entity2.attributes).filter((k) => entity2.attributes[k] !== null && entity2.attributes[k] !== undefined));
  const shared = [...keys1].filter((k) => keys2.has(k));
  if (shared.length === 0) return 0;
  const matching = shared.filter((k) => {
    const v1 = attrString(entity1, k).toLowerCase();
    const v2 = attrString(entity2, k).toLowerCase();
    return v1 && v1 === v2;
  }).length;
  return matching / Math.max(keys1.size, keys2.size, 1);
}

// ─── EntityDeduplicator ────────────────────────────────────────────────────────

type RuleRow = {
  id: string;
  name: string;
  entity_type: string;
  condition_json: RuleCondition;
  confidence: string;
  enabled_at: Date;
};

/**
 * Rule-based entity deduplication service.
 * Complements cosine-similarity matching with configurable structural rules
 * to detect duplicates with identical field values or minor variations.
 */
export class EntityDeduplicator {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Persist deduplication rules for a workspace + entity type.
   *
   * @param workspaceId - Workspace to scope the rules to
   * @param entityType  - Entity type the rules apply to (e.g., 'contact')
   * @param rules       - One or more rule definitions
   * @returns Array of generated rule IDs
   */
  async defineDeduplicationRules(
    workspaceId: string,
    entityType: string,
    rules: DeduplicationRule[],
    createdBy?: string,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const rule of rules) {
      const rows = await this.sql<Array<{ id: string }>>`
        INSERT INTO entity_dedup_rules
          (workspace_id, entity_type, name, condition_json, confidence, created_by)
        VALUES
          (${workspaceId}, ${entityType}, ${rule.name},
           ${JSON.stringify(rule.condition)}, ${rule.confidence ?? 'medium'},
           ${createdBy ?? null})
        RETURNING id
      `;
      const id = rows[0]?.id ?? '';
      if (id) ids.push(id);
    }
    log.info('Deduplication rules defined', { workspaceId, entityType, count: rules.length });
    return ids;
  }

  /**
   * Load all active deduplication rules for a workspace + entity type.
   */
  async getRules(workspaceId: string, entityType: string): Promise<(DeduplicationRule & { id: string })[]> {
    const rows = await this.sql<RuleRow[]>`
      SELECT id, name, entity_type, condition_json, confidence
      FROM entity_dedup_rules
      WHERE workspace_id = ${workspaceId}
        AND entity_type = ${entityType}
        AND enabled_at IS NOT NULL
      ORDER BY enabled_at ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      entityType: r.entity_type,
      condition: r.condition_json,
      confidence: r.confidence as DeduplicationRule['confidence'],
    }));
  }

  /**
   * Apply stored rules against a batch of entities to find duplicate groups.
   * Does an O(n²) pairwise comparison — intended for batches up to ~500 entities.
   *
   * @param entities    - Candidate entities to deduplicate
   * @param entityType  - Entity type (used to look up relevant rules)
   * @param workspaceId - Workspace scope
   * @returns           - Array of duplicate groups (canonical + duplicates)
   */
  async applyRules(
    entities: SemanticEntity[],
    entityType: string,
    workspaceId: string,
  ): Promise<DuplicateGroup[]> {
    const rules = await this.getRules(workspaceId, entityType);
    if (rules.length === 0 || entities.length < 2) return [];

    const groups: DuplicateGroup[] = [];
    const grouped = new Set<string>();

    for (let i = 0; i < entities.length; i++) {
      const a = entities[i]!;
      if (grouped.has(a.id)) continue;

      const groupDups: SemanticEntity[] = [];
      const firedRuleIds = new Set<string>();
      let totalScore = 0;

      for (let j = i + 1; j < entities.length; j++) {
        const b = entities[j]!;
        if (grouped.has(b.id)) continue;

        const firedRules = rules.filter((r) => evaluateCondition(a, b, r.condition));
        if (firedRules.length === 0) continue;

        const score = this.scorePair(a, b, firedRules);
        if (score >= 0.5) {
          groupDups.push(b);
          firedRules.forEach((r) => firedRuleIds.add(r.id));
          totalScore = Math.max(totalScore, score);
          grouped.add(b.id);
        }
      }

      if (groupDups.length > 0) {
        grouped.add(a.id);
        groups.push({
          canonical: a,
          duplicates: groupDups,
          ruleIds: [...firedRuleIds],
          score: totalScore,
        });
      }
    }

    log.info('Rule-based dedup complete', {
      workspaceId,
      entityType,
      inputCount: entities.length,
      groupCount: groups.length,
      totalDuplicates: groups.reduce((s, g) => s + g.duplicates.length, 0),
    });

    return groups;
  }

  /**
   * Compute a 0–1 confidence score for a candidate duplicate pair.
   * Weights: embedding cosine similarity (0.5), rule match ratio (0.3), attribute overlap (0.2).
   *
   * @param entity1       - First candidate
   * @param entity2       - Second candidate
   * @param rules         - Rules to evaluate; pass empty array for overlap-only score
   * @param embeddingVecs - Optional pre-computed embedding vectors for both entities
   */
  scoreCandidate(
    entity1: SemanticEntity,
    entity2: SemanticEntity,
    rules: (DeduplicationRule & { id: string })[],
    embeddingVecs?: { v1: number[]; v2: number[] },
  ): CandidateScore {
    const firedRules = rules.filter((r) => evaluateCondition(entity1, entity2, r.condition));
    return this.scorePairDetailed(entity1, entity2, firedRules, rules.length, embeddingVecs);
  }

  /** Preview rules against sample entities without persisting. */
  previewRules(
    entities: SemanticEntity[],
    rules: DeduplicationRule[],
  ): DuplicateGroup[] {
    if (rules.length === 0 || entities.length < 2) return [];
    const rulesWithId = rules.map((r, i) => ({ ...r, id: r.id ?? `preview-${i}` }));
    const groups: DuplicateGroup[] = [];
    const grouped = new Set<string>();

    for (let i = 0; i < entities.length; i++) {
      const a = entities[i]!;
      if (grouped.has(a.id)) continue;
      const groupDups: SemanticEntity[] = [];
      const firedRuleIds = new Set<string>();
      let totalScore = 0;

      for (let j = i + 1; j < entities.length; j++) {
        const b = entities[j]!;
        if (grouped.has(b.id)) continue;
        const fired = rulesWithId.filter((r) => evaluateCondition(a, b, r.condition));
        if (fired.length === 0) continue;
        const score = this.scorePair(a, b, fired);
        if (score >= 0.5) {
          groupDups.push(b);
          fired.forEach((r) => firedRuleIds.add(r.id));
          totalScore = Math.max(totalScore, score);
          grouped.add(b.id);
        }
      }

      if (groupDups.length > 0) {
        grouped.add(a.id);
        groups.push({ canonical: a, duplicates: groupDups, ruleIds: [...firedRuleIds], score: totalScore });
      }
    }
    return groups;
  }

  private scorePair(
    a: SemanticEntity,
    b: SemanticEntity,
    firedRules: (DeduplicationRule & { id: string })[],
  ): number {
    const overlap = attributeOverlapRatio(a, b);
    const ruleRatio = firedRules.length > 0 ? 1 : 0;
    return 0.3 * ruleRatio + 0.2 * overlap + 0.5 * 0.8; // embedding weight defaulted to 0.8 (unknown)
  }

  private scorePairDetailed(
    entity1: SemanticEntity,
    entity2: SemanticEntity,
    firedRules: (DeduplicationRule & { id: string })[],
    totalRules: number,
    embeddingVecs?: { v1: number[]; v2: number[] },
  ): CandidateScore {
    const embeddingWeight = embeddingVecs
      ? cosineSimilarity(embeddingVecs.v1, embeddingVecs.v2)
      : 0;
    const ruleWeight = totalRules > 0 ? firedRules.length / totalRules : 0;
    const overlapWeight = attributeOverlapRatio(entity1, entity2);

    const score = 0.5 * embeddingWeight + 0.3 * ruleWeight + 0.2 * overlapWeight;

    return {
      score: Math.min(1, Math.max(0, score)),
      embeddingWeight,
      ruleWeight,
      overlapWeight,
      firedRules: firedRules.map((r) => r.id),
    };
  }
}
