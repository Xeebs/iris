import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { SemanticEntity } from '@iris/connector-sdk';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { generateEmbeddings } from './embedding.js';
import type { VectorStore } from './vector-store.js';

const log = logger.child({ service: 'entity-deduplication' });

type SqlClient = ReturnType<typeof postgres>;

export type DuplicateSignals = {
  nameSimilarity: number;
  emailDomainMatch: boolean;
  embeddingSimilarity: number;
  compositeScore: number;
};

export type DuplicatePair = {
  entityA: SemanticEntity;
  entityB: SemanticEntity;
  signals: DuplicateSignals;
  confidence: 'high' | 'medium' | 'low';
};

export type CanonicalLink = {
  id: string;
  workspaceId: string;
  canonicalEntityId: string;
  duplicateEntityId: string;
  similarityScore: number;
  signals: DuplicateSignals;
  mergedBy: string | null;
  mergedAt: string | null;
  createdAt: string;
};

export type DeduplicationReport = {
  workspaceId: string;
  scannedCount: number;
  candidatePairs: DuplicatePair[];
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  analyzedAt: string;
};

/** Levenshtein edit distance between two strings (case-insensitive). */
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
      dp[i]![j] = s1[i - 1] === s2[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

/**
 * Normalized name similarity in [0, 1].
 * 1 = identical, 0 = completely different.
 */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

/**
 * Returns true if both entities share the same email domain.
 * Extracts domain from any string attribute containing '@'.
 */
export function emailDomainMatch(a: SemanticEntity, b: SemanticEntity): boolean {
  function getDomain(entity: SemanticEntity): string | null {
    for (const v of Object.values(entity.attributes)) {
      if (typeof v === 'string' && v.includes('@')) {
        const parts = v.split('@');
        return parts[1]?.toLowerCase() ?? null;
      }
    }
    return null;
  }
  const da = getDomain(a);
  const db = getDomain(b);
  return da !== null && da === db;
}

/**
 * Composite similarity score using multiple signals.
 * Weights: name 40%, email domain 30%, embedding 30%.
 */
export function computeCompositeScore(
  nameScore: number,
  emailMatch: boolean,
  embeddingScore: number,
): number {
  return 0.4 * nameScore + 0.3 * (emailMatch ? 1 : 0) + 0.3 * embeddingScore;
}

function toConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.80) return 'high';
  if (score >= 0.60) return 'medium';
  return 'low';
}

/**
 * Detects duplicate entities across connectors using embedding similarity + attribute signals.
 */
export class EntityDuplicateMatcher {
  constructor(
    private readonly vectorStore: VectorStore,
    private readonly sql: SqlClient,
  ) {}

  /**
   * Scan a workspace for potential duplicate entities.
   * Uses vector search to find near-duplicate candidates efficiently (O(n log n)).
   *
   * @param workspaceId - Workspace to scan
   * @param entityType - Optional: restrict to a single entity type
   * @param threshold - Minimum composite score to include in results (default: 0.60)
   * @param topK - Number of candidates to compare per entity (default: 5)
   */
  async analyze(
    workspaceId: string,
    options: { entityType?: string; threshold?: number; topK?: number } = {},
  ): Promise<Result<DeduplicationReport, Error>> {
    const { entityType, threshold = 0.60, topK = 5 } = options;

    try {
      const entities = entityType
        ? await this.vectorStore.listByType(workspaceId, entityType, 500)
        : await this.listAllEntities(workspaceId);

      log.info('Deduplication scan started', { workspaceId, count: entities.length, entityType });

      const seen = new Set<string>();
      const pairs: DuplicatePair[] = [];

      const embeddingResults = await generateEmbeddings(entities, {});
      const vectorByEntityId = new Map(embeddingResults.map((r) => [r.entityId, r.vector]));

      for (const entity of entities) {
        const embedding = vectorByEntityId.get(entity.id);
        if (!embedding) continue;

        const candidates = await this.vectorStore.search(embedding, topK + 1, { workspaceId });

        for (const { entity: candidate, score: embScore } of candidates) {
          if (candidate.id === entity.id) continue;

          const pairKey = [entity.id, candidate.id].sort().join('::');
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);

          const nameScore = nameSimilarity(entity.label, candidate.label);
          const emailMatch = emailDomainMatch(entity, candidate);
          const compositeScore = computeCompositeScore(nameScore, emailMatch, embScore);

          if (compositeScore < threshold) continue;

          pairs.push({
            entityA: entity,
            entityB: candidate,
            signals: {
              nameSimilarity: nameScore,
              emailDomainMatch: emailMatch,
              embeddingSimilarity: embScore,
              compositeScore,
            },
            confidence: toConfidence(compositeScore),
          });
        }
      }

      pairs.sort((a, b) => b.signals.compositeScore - a.signals.compositeScore);

      return ok({
        workspaceId,
        scannedCount: entities.length,
        candidatePairs: pairs,
        highConfidenceCount: pairs.filter((p) => p.confidence === 'high').length,
        mediumConfidenceCount: pairs.filter((p) => p.confidence === 'medium').length,
        analyzedAt: new Date().toISOString(),
      });
    } catch (e) {
      log.error('Deduplication analysis failed', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record a canonical link between two entities.
   * The canonical entity is the one that should be returned in queries.
   * The duplicate entity will be suppressed.
   */
  async merge(
    workspaceId: string,
    canonicalEntityId: string,
    duplicateEntityId: string,
    signals: DuplicateSignals,
    mergedBy: string,
  ): Promise<Result<CanonicalLink, Error>> {
    try {
      const rows = await this.sql<CanonicalLink[]>`
        INSERT INTO canonical_entity_links (
          workspace_id,
          canonical_entity_id,
          duplicate_entity_id,
          similarity_score,
          signals,
          merged_by,
          merged_at
        ) VALUES (
          ${workspaceId},
          ${canonicalEntityId},
          ${duplicateEntityId},
          ${signals.compositeScore},
          ${JSON.stringify(signals)},
          ${mergedBy},
          now()
        )
        ON CONFLICT ON CONSTRAINT uq_canonical_link DO UPDATE
          SET merged_by = EXCLUDED.merged_by,
              merged_at = now()
        RETURNING
          id,
          workspace_id AS "workspaceId",
          canonical_entity_id AS "canonicalEntityId",
          duplicate_entity_id AS "duplicateEntityId",
          similarity_score AS "similarityScore",
          signals,
          merged_by AS "mergedBy",
          merged_at::text AS "mergedAt",
          created_at::text AS "createdAt"
      `;
      const link = rows[0];
      if (!link) {
        return err(new Error('Merge insert returned no rows'));
      }
      log.info('Entities merged', { workspaceId, canonicalEntityId, duplicateEntityId, mergedBy });
      return ok(link);
    } catch (e) {
      log.error('Merge failed', { workspaceId, canonicalEntityId, duplicateEntityId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Return the set of duplicate entity IDs that should be suppressed for a workspace.
   * Used by the retrieval engine to filter out duplicates.
   */
  async getSuppressedIds(workspaceId: string): Promise<Set<string>> {
    try {
      const rows = await this.sql<Array<{ duplicateEntityId: string }>>`
        SELECT duplicate_entity_id AS "duplicateEntityId"
        FROM canonical_entity_links
        WHERE workspace_id = ${workspaceId} AND merged_at IS NOT NULL
      `;
      return new Set(rows.map((r) => r.duplicateEntityId));
    } catch (e) {
      log.error('Failed to fetch suppressed IDs', { workspaceId, error: e });
      return new Set();
    }
  }

  private async listAllEntities(workspaceId: string): Promise<SemanticEntity[]> {
    const types = ['contact', 'company', 'deal', 'activity', 'ticket', 'product'];
    const results: SemanticEntity[] = [];
    for (const type of types) {
      const entities = await this.vectorStore.listByType(workspaceId, type, 200);
      results.push(...entities);
    }
    return results;
  }
}
