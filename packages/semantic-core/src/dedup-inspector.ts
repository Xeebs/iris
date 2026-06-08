import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'dedup-inspector' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClusterMember = {
  entityId: string;
  entityType: string;
  label: string;
  attributes: Record<string, unknown>;
  sourceConnector: string;
  lastModified: Date;
  similarityToCanonical: number;
  completenessScore: number;
};

export type DedupCluster = {
  clusterId: string;
  workspaceId: string;
  entityType: string;
  memberCount: number;
  canonicalEntityId: string;
  avgSimilarity: number;
  members: ClusterMember[];
  createdAt: Date;
  mergedAt: Date | null;
};

export type EntityComparison = {
  entity1: ClusterMember;
  entity2: ClusterMember;
  matchingAttributes: string[];
  diffAttributes: Array<{ field: string; value1: unknown; value2: unknown }>;
  similarityScore: number;
  embeddingDistanceExplained: string;
};

export type MergeSuggestion = {
  recommendedCanonicalId: string;
  confidence: number;
  reason: string;
  attributesFromEach: Record<string, string>;
};

export type DedupDecisionRecord = {
  workspaceId: string;
  sourceEntityId: string;
  targetEntityId: string;
  confidenceScore: number;
  attributesCompared: string[];
  mergeStatus: 'pending' | 'approved' | 'rejected';
  reviewedByUserId: string | null;
  createdAt: Date;
};

export type DedupExplanation = {
  entity1Id: string;
  entity2Id: string;
  similarityScore: number;
  drivingAttributes: Array<{ attribute: string; contribution: number }>;
  embeddingOverlapSummary: string;
  recommendation: 'merge' | 'keep_separate';
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Estimate data completeness 0-1 based on non-null attribute count vs total fields.
 */
export function computeCompletenessScore(attributes: Record<string, unknown>): number {
  const total = Object.keys(attributes).length;
  if (total === 0) return 0;
  const filled = Object.values(attributes).filter((v) => v !== null && v !== undefined && v !== '').length;
  return Math.round((filled / total) * 100) / 100;
}

/**
 * Return attributes that differ between two attribute maps.
 */
export function diffAttributes(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Array<{ field: string; value1: unknown; value2: unknown }> {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs: Array<{ field: string; value1: unknown; value2: unknown }> = [];
  for (const key of allKeys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      diffs.push({ field: key, value1: a[key], value2: b[key] });
    }
  }
  return diffs;
}

/**
 * Return attribute keys shared between two attribute maps with equal non-null values.
 */
export function matchingAttributes(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string[] {
  return Object.keys(a).filter(
    (k) => a[k] !== null && a[k] !== undefined && JSON.stringify(a[k]) === JSON.stringify(b[k]),
  );
}

/**
 * Score which entity in a cluster should be canonical: highest completeness, most recent.
 */
export function scoreCanonicalCandidates(
  members: ClusterMember[],
): Array<{ entityId: string; score: number }> {
  const now = Date.now();
  const maxAge = Math.max(...members.map((m) => now - m.lastModified.getTime())) || 1;
  return members
    .map((m) => {
      const freshnessScore = 1 - (now - m.lastModified.getTime()) / maxAge;
      const score = m.completenessScore * 0.6 + freshnessScore * 0.4;
      return { entityId: m.entityId, score: Math.round(score * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── DedupInspector class ─────────────────────────────────────────────────────

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export class DedupInspector {
  constructor(private readonly sql: SqlFn) {}

  /**
   * List similarity clusters for a workspace and entity type.
   *
   * @param workspaceId - Workspace to query
   * @param entityType - Entity type filter (optional — all types if omitted)
   * @param limit - Max clusters to return
   */
  async analyzeDedupClusters(
    workspaceId: string,
    entityType?: string,
    limit = 50,
  ): Promise<Result<DedupCluster[], Error>> {
    try {
      let rows: ClusterRow[];
      if (entityType) {
        rows = await this.sql`
          SELECT
            dc.cluster_id,
            dc.workspace_id,
            dc.entity_type,
            dc.member_count,
            dc.canonical_entity_id,
            dc.similarity_scores_json,
            dc.created_at,
            dc.merged_at
          FROM dedup_clusters dc
          WHERE dc.workspace_id = ${workspaceId}
            AND dc.entity_type = ${entityType}
          ORDER BY dc.member_count DESC, dc.created_at DESC
          LIMIT ${limit}
        ` as ClusterRow[];
      } else {
        rows = await this.sql`
          SELECT
            dc.cluster_id,
            dc.workspace_id,
            dc.entity_type,
            dc.member_count,
            dc.canonical_entity_id,
            dc.similarity_scores_json,
            dc.created_at,
            dc.merged_at
          FROM dedup_clusters dc
          WHERE dc.workspace_id = ${workspaceId}
          ORDER BY dc.member_count DESC, dc.created_at DESC
          LIMIT ${limit}
        ` as ClusterRow[];
      }

      const clusters = rows.map((r) => ({
        clusterId: r.cluster_id,
        workspaceId: r.workspace_id,
        entityType: r.entity_type,
        memberCount: r.member_count,
        canonicalEntityId: r.canonical_entity_id,
        avgSimilarity: computeAvgSimilarity(r.similarity_scores_json),
        members: [],
        createdAt: new Date(r.created_at),
        mergedAt: r.merged_at ? new Date(r.merged_at) : null,
      }));

      log.info('Dedup clusters analyzed', { workspaceId, entityType, count: clusters.length });
      return ok(clusters);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Side-by-side comparison of two entities' attributes, relationships, and source connectors.
   *
   * @param entity1Id - First entity ID
   * @param entity2Id - Second entity ID
   * @param workspaceId - Workspace context
   */
  async compareEntities(
    entity1Id: string,
    entity2Id: string,
    workspaceId: string,
  ): Promise<Result<EntityComparison, Error>> {
    try {
      const rows = await this.sql`
        SELECT
          e.entity_id,
          e.entity_type,
          e.label,
          e.attributes_json,
          e.source_connector,
          e.last_modified,
          COALESCE(dd.confidence_score, 0) AS similarity_score
        FROM indexed_entities e
        LEFT JOIN dedup_decisions dd ON (
          (dd.source_entity_id = ${entity1Id} AND dd.target_entity_id = ${entity2Id})
          OR (dd.source_entity_id = ${entity2Id} AND dd.target_entity_id = ${entity1Id})
        )
        WHERE e.workspace_id = ${workspaceId}
          AND e.entity_id IN (${entity1Id}, ${entity2Id})
      ` as EntityRow[];

      if (rows.length < 2) {
        return err(new Error(`One or both entities not found: ${entity1Id}, ${entity2Id}`));
      }

      const r1 = rows.find((r) => r.entity_id === entity1Id)!;
      const r2 = rows.find((r) => r.entity_id === entity2Id)!;

      const attrs1 = safeParseJson(r1.attributes_json);
      const attrs2 = safeParseJson(r2.attributes_json);

      const m1: ClusterMember = {
        entityId: r1.entity_id,
        entityType: r1.entity_type,
        label: r1.label,
        attributes: attrs1,
        sourceConnector: r1.source_connector,
        lastModified: new Date(r1.last_modified),
        similarityToCanonical: r1.similarity_score,
        completenessScore: computeCompletenessScore(attrs1),
      };
      const m2: ClusterMember = {
        entityId: r2.entity_id,
        entityType: r2.entity_type,
        label: r2.label,
        attributes: attrs2,
        sourceConnector: r2.source_connector,
        lastModified: new Date(r2.last_modified),
        similarityToCanonical: r2.similarity_score,
        completenessScore: computeCompletenessScore(attrs2),
      };

      return ok({
        entity1: m1,
        entity2: m2,
        matchingAttributes: matchingAttributes(attrs1, attrs2),
        diffAttributes: diffAttributes(attrs1, attrs2),
        similarityScore: r1.similarity_score,
        embeddingDistanceExplained: `Entities share ${matchingAttributes(attrs1, attrs2).length} identical attribute(s); cosine similarity is ${r1.similarity_score.toFixed(3)}.`,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Recommend which entity in a cluster should be canonical.
   *
   * @param members - Cluster members
   */
  suggestMerge(members: ClusterMember[]): Result<MergeSuggestion, Error> {
    if (members.length < 2) {
      return err(new Error('At least 2 cluster members required for merge suggestion'));
    }

    const ranked = scoreCanonicalCandidates(members);
    const topId = ranked[0]!.entityId;
    const top = members.find((m) => m.entityId === topId)!;
    const others = members.filter((m) => m.entityId !== topId);

    const attributesFromEach: Record<string, string> = {};
    for (const other of others) {
      const diffs = diffAttributes(top.attributes, other.attributes);
      for (const d of diffs) {
        if (d.value2 !== null && d.value2 !== undefined && d.value2 !== '') {
          attributesFromEach[d.field] = other.entityId;
        }
      }
    }

    return ok({
      recommendedCanonicalId: topId,
      confidence: ranked[0]!.score,
      reason: `Entity has highest data completeness (${(top.completenessScore * 100).toFixed(0)}%) and is most recent (${top.lastModified.toISOString()}).`,
      attributesFromEach,
    });
  }

  /**
   * Persist a merge approval decision and write a dedup_decision record.
   *
   * @param entity1Id - Source entity ID
   * @param entity2Id - Target entity ID
   * @param canonicalId - Chosen canonical entity
   * @param reviewedBy - Reviewer user ID
   * @param workspaceId - Workspace context
   */
  async approveMerge(
    entity1Id: string,
    entity2Id: string,
    canonicalId: string,
    reviewedBy: string,
    workspaceId: string,
  ): Promise<Result<DedupDecisionRecord, Error>> {
    try {
      const confidenceRow = await this.sql`
        SELECT confidence_score FROM dedup_decisions
        WHERE workspace_id = ${workspaceId}
          AND ((source_entity_id = ${entity1Id} AND target_entity_id = ${entity2Id})
               OR (source_entity_id = ${entity2Id} AND target_entity_id = ${entity1Id}))
        LIMIT 1
      ` as Array<{ confidence_score: number }>;

      const confidence = confidenceRow[0]?.confidence_score ?? 0.85;

      await this.sql`
        INSERT INTO dedup_decisions
          (workspace_id, source_entity_id, target_entity_id, confidence_score, attributes_compared_json, merge_status, reviewed_by_user_id)
        VALUES
          (${workspaceId}, ${entity1Id}, ${entity2Id}, ${confidence}, '[]'::jsonb, 'approved', ${reviewedBy})
        ON CONFLICT (workspace_id, source_entity_id, target_entity_id) DO UPDATE SET
          merge_status = 'approved',
          reviewed_by_user_id = EXCLUDED.reviewed_by_user_id
      `;

      await this.sql`
        UPDATE dedup_clusters
        SET merged_at = NOW(), canonical_entity_id = ${canonicalId}
        WHERE workspace_id = ${workspaceId}
          AND (${entity1Id} = ANY(ARRAY[canonical_entity_id]) OR canonical_entity_id IS NOT NULL)
      `;

      log.info('Merge approved', { entity1Id, entity2Id, canonicalId, workspaceId });

      return ok({
        workspaceId,
        sourceEntityId: entity1Id,
        targetEntityId: entity2Id,
        confidenceScore: confidence,
        attributesCompared: [],
        mergeStatus: 'approved',
        reviewedByUserId: reviewedBy,
        createdAt: new Date(),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Explain why two entities were flagged as duplicates.
   *
   * @param entity1Id - First entity
   * @param entity2Id - Second entity
   * @param workspaceId - Workspace context
   */
  async explainDedupDecision(
    entity1Id: string,
    entity2Id: string,
    workspaceId: string,
  ): Promise<Result<DedupExplanation, Error>> {
    try {
      const rows = await this.sql`
        SELECT
          e.entity_id,
          e.attributes_json,
          COALESCE(dd.confidence_score, 0) AS similarity_score,
          COALESCE(dd.attributes_compared_json, '[]'::jsonb) AS attributes_compared_json
        FROM indexed_entities e
        LEFT JOIN dedup_decisions dd ON (
          (dd.source_entity_id = ${entity1Id} AND dd.target_entity_id = ${entity2Id})
          OR (dd.source_entity_id = ${entity2Id} AND dd.target_entity_id = ${entity1Id})
        )
        WHERE e.workspace_id = ${workspaceId}
          AND e.entity_id IN (${entity1Id}, ${entity2Id})
      ` as Array<{ entity_id: string; attributes_json: string; similarity_score: number; attributes_compared_json: string }>;

      if (rows.length < 1) {
        return err(new Error('Entity data not found'));
      }

      const r1 = rows.find((r) => r.entity_id === entity1Id);
      const r2 = rows.find((r) => r.entity_id === entity2Id);
      const similarityScore = r1?.similarity_score ?? r2?.similarity_score ?? 0;

      const attrs1 = r1 ? safeParseJson(r1.attributes_json) : {};
      const attrs2 = r2 ? safeParseJson(r2.attributes_json) : {};
      const matched = matchingAttributes(attrs1, attrs2);

      const drivingAttributes = matched.map((attr, i) => ({
        attribute: attr,
        contribution: Math.max(0.05, 0.25 - i * 0.03),
      }));

      return ok({
        entity1Id,
        entity2Id,
        similarityScore,
        drivingAttributes,
        embeddingOverlapSummary: `${matched.length} shared attribute(s) drive the ${(similarityScore * 100).toFixed(1)}% similarity score: ${matched.slice(0, 3).join(', ')}.`,
        recommendation: similarityScore >= 0.85 ? 'merge' : 'keep_separate',
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function computeAvgSimilarity(scoresJson: string): number {
  try {
    const scores = JSON.parse(scoresJson) as number[];
    if (!scores.length) return 0;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000;
  } catch {
    return 0;
  }
}

function safeParseJson(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type ClusterRow = {
  cluster_id: string;
  workspace_id: string;
  entity_type: string;
  member_count: number;
  canonical_entity_id: string;
  similarity_scores_json: string;
  created_at: string;
  merged_at: string | null;
};

type EntityRow = {
  entity_id: string;
  entity_type: string;
  label: string;
  attributes_json: string;
  source_connector: string;
  last_modified: string;
  similarity_score: number;
};
