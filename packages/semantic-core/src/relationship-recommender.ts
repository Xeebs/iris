import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'relationship-recommender' });

const AUTO_LINK_CONFIDENCE_THRESHOLD = 0.75;

// ─── Types ────────────────────────────────────────────────────────────────────

export type RelationshipSuggestion = {
  fromId: string;
  toId: string;
  toType: string;
  toLabel: string;
  relationshipType: string;
  confidence: number;
  reasons: string[];
};

export type AutoLinkResult = {
  fromId: string;
  toId: string;
  relationshipType: string;
  confidence: number;
  autoApproved: boolean;
};

export type RelationshipFeedback = {
  id: string;
  fromId: string;
  toId: string;
  accepted: boolean;
  recordedAt: Date;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute relationship confidence from individual signal components.
 * Weights: embedding similarity 40%, co-occurrence 30%, type compatibility 20%, domain rules 10%.
 * @param embeddingSimilarity - Cosine similarity of entity embeddings (0-1)
 * @param cooccurrenceScore - Normalized co-access frequency (0-1)
 * @param typeCompatibility - Schema-defined type compatibility (0-1)
 * @param domainRuleScore - Domain-rule match score (0-1)
 * @returns Composite confidence 0-1
 */
export function computeRelationshipConfidence(
  embeddingSimilarity: number,
  cooccurrenceScore: number,
  typeCompatibility: number,
  domainRuleScore: number,
): number {
  return (
    embeddingSimilarity * 0.4 +
    cooccurrenceScore * 0.3 +
    typeCompatibility * 0.2 +
    domainRuleScore * 0.1
  );
}

/**
 * Determine if a relationship type is compatible between two entity types.
 * @param fromType - Source entity type
 * @param toType - Target entity type
 * @param relationshipType - Proposed relationship type
 * @returns 1.0 if compatible, 0.5 if unknown, 0.0 if incompatible
 */
export function computeTypeCompatibility(fromType: string, toType: string, relationshipType: string): number {
  const COMPATIBLE_PAIRS: Record<string, string[]> = {
    'contact:belongs_to': ['company'],
    'deal:owned_by': ['contact', 'company'],
    'activity:related_to': ['contact', 'deal', 'company'],
    'contact:knows': ['contact'],
  };
  const key = `${fromType}:${relationshipType}`;
  const allowed = COMPATIBLE_PAIRS[key];
  if (!allowed) return 0.5;
  return allowed.includes(toType) ? 1.0 : 0.0;
}

/**
 * Generate human-readable reasons for a relationship suggestion.
 * @param embeddingSimilarity - Embedding similarity score
 * @param cooccurrenceScore - Co-occurrence score
 * @param typeCompatibility - Type compatibility score
 * @returns List of reason strings
 */
export function generateRelationshipReasons(
  embeddingSimilarity: number,
  cooccurrenceScore: number,
  typeCompatibility: number,
): string[] {
  const reasons: string[] = [];
  if (embeddingSimilarity > 0.7) reasons.push('High semantic similarity');
  else if (embeddingSimilarity > 0.4) reasons.push('Moderate semantic similarity');
  if (cooccurrenceScore > 0.5) reasons.push('Frequently co-accessed together');
  if (typeCompatibility >= 1.0) reasons.push('Schema-compatible entity types');
  if (reasons.length === 0) reasons.push('Potential relationship detected');
  return reasons;
}

/**
 * Check if a candidate relationship has been previously denied.
 * @param fromId - Source entity
 * @param toId - Target entity
 * @param denyList - Set of "fromId:toId" keys
 * @returns true if denied
 */
export function isDenied(fromId: string, toId: string, denyList: Set<string>): boolean {
  return denyList.has(`${fromId}:${toId}`) || denyList.has(`${toId}:${fromId}`);
}

// ─── RelationshipRecommendationService ───────────────────────────────────────

export class RelationshipRecommendationService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Suggest potential relationships for an entity using multiple confidence signals.
   * @param entityId - Source entity to find relationships for
   * @param topK - Maximum number of suggestions to return
   * @returns Ranked relationship suggestions
   */
  async suggestRelationships(
    entityId: string,
    topK = 10,
  ): Promise<Result<RelationshipSuggestion[], Error>> {
    try {
      type EntityRow = { type: string };
      const [entity] = await this.sql<EntityRow[]>`SELECT type FROM iris_entities WHERE id = ${entityId}`;
      if (!entity) return err(new Error(`Entity ${entityId} not found`));

      type CoRow = { entity_id: string; entity_type: string; cooccurrence_count: number };
      const coAccessCandidates = await this.sql<CoRow[]>`
        SELECT tcu2.entity_id, tcu2.entity_type, COUNT(*)::int AS cooccurrence_count
        FROM team_context_usage tcu1
        JOIN team_context_usage tcu2
          ON tcu1.team_id = tcu2.team_id AND tcu2.entity_id != ${entityId}
        WHERE tcu1.entity_id = ${entityId}
        GROUP BY tcu2.entity_id, tcu2.entity_type
        ORDER BY cooccurrence_count DESC
        LIMIT ${topK * 2}
      `;

      type DenyRow = { from_id: string; to_id: string };
      const denyRows = await this.sql<DenyRow[]>`
        SELECT from_id, to_id FROM relationship_feedback
        WHERE (from_id = ${entityId} OR to_id = ${entityId}) AND accepted = false
      `;
      const denyList = new Set(denyRows.map((d) => `${d.from_id}:${d.to_id}`));

      const maxCooccurrence = Math.max(...coAccessCandidates.map((c) => c.cooccurrence_count), 1);
      const suggestions: RelationshipSuggestion[] = [];

      for (const candidate of coAccessCandidates) {
        if (isDenied(entityId, candidate.entity_id, denyList)) continue;
        const embeddingSim = 0.5; // placeholder — real impl would query vector store
        const cooccurrence = candidate.cooccurrence_count / maxCooccurrence;
        const typeCompat = computeTypeCompatibility(entity.type, candidate.entity_type, 'related_to');
        const confidence = computeRelationshipConfidence(embeddingSim, cooccurrence, typeCompat, 0.5);
        const reasons = generateRelationshipReasons(embeddingSim, cooccurrence, typeCompat);
        suggestions.push({
          fromId: entityId, toId: candidate.entity_id,
          toType: candidate.entity_type, toLabel: candidate.entity_id,
          relationshipType: 'related_to', confidence, reasons,
        });
      }

      suggestions.sort((a, b) => b.confidence - a.confidence);
      return ok(suggestions.slice(0, topK));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Create an auto-link between two entities if confidence meets threshold.
   * @param fromId - Source entity
   * @param toId - Target entity
   * @param relationshipType - Relationship type
   * @param confidence - Confidence score (0-1)
   * @returns Auto-link result
   */
  async autoLinkEntities(
    fromId: string,
    toId: string,
    relationshipType: string,
    confidence: number,
  ): Promise<Result<AutoLinkResult, Error>> {
    if (confidence < AUTO_LINK_CONFIDENCE_THRESHOLD) {
      return err(new Error(`Confidence ${confidence} is below threshold ${AUTO_LINK_CONFIDENCE_THRESHOLD}`));
    }
    const id = randomUUID();
    try {
      await this.sql`
        INSERT INTO relationship_suggestions (id, from_id, to_id, relationship_type, confidence, auto_approved)
        VALUES (${id}, ${fromId}, ${toId}, ${relationshipType}, ${confidence}, true)
        ON CONFLICT (from_id, to_id, relationship_type) DO UPDATE SET
          confidence = EXCLUDED.confidence, auto_approved = true, updated_at = NOW()
      `;
      log.info('Auto-link created', { fromId, toId, relationshipType, confidence });
      return ok({ fromId, toId, relationshipType, confidence, autoApproved: true });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record a negative feedback signal to prevent re-suggesting a relationship.
   * @param fromId - Source entity
   * @param toId - Target entity
   */
  async denyRelationshipSuggestion(fromId: string, toId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO relationship_feedback (id, from_id, to_id, accepted, recorded_at)
        VALUES (${randomUUID()}, ${fromId}, ${toId}, false, NOW())
        ON CONFLICT (from_id, to_id) DO UPDATE SET accepted = false, recorded_at = NOW()
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record positive feedback to reinforce the model.
   * @param fromId - Source entity
   * @param toId - Target entity
   */
  async acceptRelationshipSuggestion(fromId: string, toId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO relationship_feedback (id, from_id, to_id, accepted, recorded_at)
        VALUES (${randomUUID()}, ${fromId}, ${toId}, true, NOW())
        ON CONFLICT (from_id, to_id) DO UPDATE SET accepted = true, recorded_at = NOW()
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Batch suggest relationships for multiple entities.
   * @param entityIds - List of entity IDs to suggest for
   * @param topK - Per-entity suggestion limit
   */
  async bulkSuggestRelationships(
    entityIds: string[],
    topK = 5,
  ): Promise<Result<{ entityId: string; suggestions: RelationshipSuggestion[] }[], Error>> {
    try {
      const results = await Promise.all(
        entityIds.map(async (entityId) => {
          const r = await this.suggestRelationships(entityId, topK);
          return { entityId, suggestions: r.isOk() ? r.value : [] };
        }),
      );
      return ok(results);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve suggestion performance metrics (acceptance rate, confidence distribution).
   */
  async getSuggestionMetrics(): Promise<Result<{ totalSuggested: number; accepted: number; denied: number; acceptanceRate: number }, Error>> {
    try {
      type Row = { total: number; accepted_count: number; denied_count: number };
      const [row] = await this.sql<Row[]>`
        SELECT COUNT(*)::int AS total,
               SUM(CASE WHEN accepted = true THEN 1 ELSE 0 END)::int AS accepted_count,
               SUM(CASE WHEN accepted = false THEN 1 ELSE 0 END)::int AS denied_count
        FROM relationship_feedback
      `;
      const total = row?.total ?? 0;
      const accepted = row?.accepted_count ?? 0;
      const denied = row?.denied_count ?? 0;
      return ok({ totalSuggested: total, accepted, denied, acceptanceRate: total > 0 ? accepted / total : 0 });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
