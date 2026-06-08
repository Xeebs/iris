import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'relationship-inference' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type DiscoveryMethod = 'cooccurrence' | 'embedding_similarity' | 'metadata_pattern';

export type InferredRelationship = {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipTypePredicted: string;
  confidenceScore: number;
  discoveryMethod: DiscoveryMethod;
  suggestedAt: Date;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
};

export type CooccurrenceEntry = {
  entityA: string;
  entityB: string;
  cooccurrenceCount: number;
  cooccurrenceScore: number;
};

export type ImplicitRelationshipScore = {
  sourceEntityId: string;
  targetEntityId: string;
  confidence: number;
  discoveryMethod: DiscoveryMethod;
  predictedType: string;
  breakdown: {
    cooccurrenceWeight: number;
    typeCompatibilityWeight: number;
    embeddingSimilarityWeight: number;
  };
};

/** Minimum confidence threshold to surface a relationship suggestion. */
const CONFIDENCE_THRESHOLD = 0.75;

/** Compatible entity type pairs for relationship inference. */
const COMPATIBLE_TYPE_PAIRS: Record<string, string[]> = {
  contact: ['company', 'deal', 'activity', 'task'],
  company: ['contact', 'deal', 'contract', 'metric'],
  deal: ['contact', 'company', 'product', 'activity'],
  activity: ['contact', 'deal', 'task'],
  task: ['contact', 'activity', 'deal'],
  product: ['deal', 'company'],
  metric: ['company', 'deal'],
};

/** Predict relationship type based on entity type combination. */
function predictRelationshipType(typeA: string, typeB: string): string {
  const a = typeA.toLowerCase();
  const b = typeB.toLowerCase();
  if ((a === 'contact' && b === 'company') || (a === 'company' && b === 'contact')) return 'employed_by';
  if ((a === 'deal' && b === 'contact') || (a === 'contact' && b === 'deal')) return 'involved_in';
  if ((a === 'deal' && b === 'company') || (a === 'company' && b === 'deal')) return 'opportunity_for';
  if (a === 'activity' || b === 'activity') return 'has_activity';
  return 'related_to';
}

/** Check whether two entity types are compatible for inference. */
function areCompatibleTypes(typeA: string, typeB: string): boolean {
  const compatA = COMPATIBLE_TYPE_PAIRS[typeA.toLowerCase()] ?? [];
  return compatA.includes(typeB.toLowerCase());
}

/**
 * Build a co-occurrence matrix from query/context access logs.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param days - Lookback window
 */
export async function buildCooccurrenceMatrix(
  sql: SqlFn,
  workspaceId: string,
  days = 90,
): Promise<Result<CooccurrenceEntry[], Error>> {
  try {
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await sql`
      SELECT entity_a, entity_b, COUNT(*) AS cooccurrence_count
      FROM entity_cooccurrence_log
      WHERE workspace_id = ${workspaceId}
        AND logged_at >= ${since}
      GROUP BY entity_a, entity_b
      HAVING COUNT(*) >= 3
      ORDER BY cooccurrence_count DESC
      LIMIT 1000
    ` as unknown as Array<{ entity_a: string; entity_b: string; cooccurrence_count: string }>;

    // Find max count for normalization
    const maxCount = Math.max(...rows.map(r => parseInt(r.cooccurrence_count, 10)), 1);

    return ok(rows.map(r => {
      const count = parseInt(r.cooccurrence_count, 10);
      return {
        entityA: r.entity_a,
        entityB: r.entity_b,
        cooccurrenceCount: count,
        cooccurrenceScore: count / maxCount,
      };
    }));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Score the likelihood of an implicit relationship between two entities.
 * @param sourceEntityId - Source entity ID
 * @param sourceEntityType - Source entity type
 * @param targetEntityId - Target entity ID
 * @param targetEntityType - Target entity type
 * @param cooccurrenceScore - Score from co-occurrence matrix (0-1)
 * @param embeddingSimilarity - Cosine similarity between entity embeddings (0-1)
 */
export function detectImplicitRelationships(
  sourceEntityId: string,
  sourceEntityType: string,
  targetEntityId: string,
  targetEntityType: string,
  cooccurrenceScore: number,
  embeddingSimilarity: number,
): ImplicitRelationshipScore {
  const typeCompatibilityWeight = areCompatibleTypes(sourceEntityType, targetEntityType) ? 0.3 : 0;
  const cooccurrenceWeight = cooccurrenceScore * 0.4;
  const embeddingSimilarityWeight = embeddingSimilarity * 0.3;

  const confidence = Math.min(1, cooccurrenceWeight + typeCompatibilityWeight + embeddingSimilarityWeight);

  let discoveryMethod: DiscoveryMethod;
  if (cooccurrenceScore > embeddingSimilarity) {
    discoveryMethod = 'cooccurrence';
  } else if (embeddingSimilarity > 0.7) {
    discoveryMethod = 'embedding_similarity';
  } else {
    discoveryMethod = 'metadata_pattern';
  }

  return {
    sourceEntityId,
    targetEntityId,
    confidence: Math.round(confidence * 1000) / 1000,
    discoveryMethod,
    predictedType: predictRelationshipType(sourceEntityType, targetEntityType),
    breakdown: {
      cooccurrenceWeight: Math.round(cooccurrenceWeight * 1000) / 1000,
      typeCompatibilityWeight: Math.round(typeCompatibilityWeight * 1000) / 1000,
      embeddingSimilarityWeight: Math.round(embeddingSimilarityWeight * 1000) / 1000,
    },
  };
}

/**
 * Validate an inferred relationship against the confidence threshold.
 * @param relationship - Inferred relationship to validate
 */
export function validateInferredRelationship(relationship: ImplicitRelationshipScore): boolean {
  return relationship.confidence >= CONFIDENCE_THRESHOLD;
}

/**
 * Predict the top K most likely missing relationships for a given entity.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param entityId - Entity to find missing links for
 * @param entityType - Entity type
 * @param topK - Max suggestions to return
 */
export async function predictMissingRelationships(
  sql: SqlFn,
  workspaceId: string,
  entityId: string,
  entityType: string,
  topK = 10,
): Promise<Result<ImplicitRelationshipScore[], Error>> {
  try {
    // Get existing relationships to avoid duplicates
    const existingRows = await sql`
      SELECT target_entity_id FROM entity_relationships
      WHERE workspace_id = ${workspaceId}
        AND source_entity_id = ${entityId}
      UNION
      SELECT source_entity_id FROM entity_relationships
      WHERE workspace_id = ${workspaceId}
        AND target_entity_id = ${entityId}
    ` as unknown as Array<{ target_entity_id: string }>;

    const existingIds = new Set(existingRows.map(r => r.target_entity_id));

    // Get candidate entities from compatible types
    const compatibleTypes = COMPATIBLE_TYPE_PAIRS[entityType.toLowerCase()] ?? [];
    if (compatibleTypes.length === 0) return ok([]);

    const candidateRows = await sql`
      SELECT id, type, embedding_vector
      FROM semantic_entities
      WHERE workspace_id = ${workspaceId}
        AND type = ANY(${compatibleTypes})
        AND id != ${entityId}
      ORDER BY last_modified DESC
      LIMIT 200
    ` as unknown as Array<{ id: string; type: string; embedding_vector: number[] | null }>;

    // Get co-occurrence data
    const cooccRows = await sql`
      SELECT entity_b AS other_id, SUM(cooccurrence_count)::FLOAT / MAX(total_count) AS score
      FROM (
        SELECT entity_b, COUNT(*) AS cooccurrence_count, (SELECT COUNT(*) FROM entity_cooccurrence_log WHERE workspace_id = ${workspaceId}) AS total_count
        FROM entity_cooccurrence_log
        WHERE workspace_id = ${workspaceId} AND entity_a = ${entityId}
        GROUP BY entity_b
        UNION ALL
        SELECT entity_a AS entity_b, COUNT(*) AS cooccurrence_count, (SELECT COUNT(*) FROM entity_cooccurrence_log WHERE workspace_id = ${workspaceId}) AS total_count
        FROM entity_cooccurrence_log
        WHERE workspace_id = ${workspaceId} AND entity_b = ${entityId}
        GROUP BY entity_a
      ) sub
      GROUP BY entity_b
    ` as unknown as Array<{ other_id: string; score: string }>;

    const cooccMap = new Map(cooccRows.map(r => [r.other_id, parseFloat(r.score)]));

    const scores: ImplicitRelationshipScore[] = [];

    for (const candidate of candidateRows) {
      if (existingIds.has(candidate.id)) continue;

      const cooccScore = cooccMap.get(candidate.id) ?? 0;
      // Without real embedding, estimate similarity as 0.5 baseline
      const embeddingSim = candidate.embedding_vector ? 0.6 : 0.4;

      const score = detectImplicitRelationships(entityId, entityType, candidate.id, candidate.type, cooccScore, embeddingSim);

      if (validateInferredRelationship(score)) {
        scores.push(score);
      }
    }

    return ok(scores.sort((a, b) => b.confidence - a.confidence).slice(0, topK));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get top unconfirmed inferred relationships for admin review.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param topK - Max suggestions to return
 */
export async function suggestRelationshipCreation(
  sql: SqlFn,
  workspaceId: string,
  topK = 20,
): Promise<Result<InferredRelationship[], Error>> {
  try {
    const rows = await sql`
      SELECT id, source_entity_id, target_entity_id, relationship_type_predicted,
             confidence_score, discovery_method, suggested_at, confirmed_at, rejected_at
      FROM inferred_relationships
      WHERE workspace_id = ${workspaceId}
        AND confirmed_at IS NULL
        AND rejected_at IS NULL
        AND confidence_score >= ${CONFIDENCE_THRESHOLD}
      ORDER BY confidence_score DESC
      LIMIT ${topK}
    ` as unknown as Array<{
      id: string;
      source_entity_id: string;
      target_entity_id: string;
      relationship_type_predicted: string;
      confidence_score: string;
      discovery_method: DiscoveryMethod;
      suggested_at: string;
      confirmed_at: string | null;
      rejected_at: string | null;
    }>;

    return ok(rows.map(r => ({
      id: r.id,
      sourceEntityId: r.source_entity_id,
      targetEntityId: r.target_entity_id,
      relationshipTypePredicted: r.relationship_type_predicted,
      confidenceScore: parseFloat(r.confidence_score),
      discoveryMethod: r.discovery_method,
      suggestedAt: new Date(r.suggested_at),
      confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : null,
      rejectedAt: r.rejected_at ? new Date(r.rejected_at) : null,
    })));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Confirm an inferred relationship (admin accepts suggestion).
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param inferredRelId - Inferred relationship ID to confirm
 */
export async function confirmInferredRelationship(
  sql: SqlFn,
  workspaceId: string,
  inferredRelId: string,
): Promise<Result<void, Error>> {
  try {
    await sql`
      UPDATE inferred_relationships
      SET confirmed_at = NOW(), rejected_at = NULL
      WHERE id = ${inferredRelId} AND workspace_id = ${workspaceId}
    `;
    log.info('Inferred relationship confirmed', { workspaceId, inferredRelId });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Reject an inferred relationship (admin dismisses suggestion).
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param inferredRelId - Inferred relationship ID to reject
 */
export async function rejectInferredRelationship(
  sql: SqlFn,
  workspaceId: string,
  inferredRelId: string,
): Promise<Result<void, Error>> {
  try {
    await sql`
      UPDATE inferred_relationships
      SET rejected_at = NOW(), confirmed_at = NULL
      WHERE id = ${inferredRelId} AND workspace_id = ${workspaceId}
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
