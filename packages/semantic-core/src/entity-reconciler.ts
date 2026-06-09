import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'entity-reconciler' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReconciliationDecision = 'merge' | 'link' | 'reject';

export type MatchCandidate = {
  candidateId: string;
  candidateConnector: string;
  confidence: number;
  attributeOverlap: number;
  embeddingDistance: number;
  reasons: string[];
};

export type ReconciliationSuggestion = {
  sourceId: string;
  candidates: MatchCandidate[];
  recommendedAction: ReconciliationDecision;
  mergeOrder: string[];
};

export type ReconciliationRecord = {
  id: string;
  sourceId: string;
  targetId: string;
  decision: ReconciliationDecision;
  recordedAt: Date;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const PII_FIELDS = new Set(['email', 'phone', 'ssn', 'tax_id']);

/**
 * Compute attribute overlap score between two entity attribute maps.
 * Only compares non-PII fields with non-null values.
 * @param a - First entity attributes
 * @param b - Second entity attributes
 * @returns Overlap fraction 0-1
 */
export function computeAttributeOverlap(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const keysA = Object.keys(a).filter((k) => !PII_FIELDS.has(k) && a[k] !== null && a[k] !== undefined);
  const keysB = new Set(Object.keys(b).filter((k) => !PII_FIELDS.has(k) && b[k] !== null && b[k] !== undefined));
  if (keysA.length === 0 || keysB.size === 0) return 0;
  const shared = keysA.filter((k) => keysB.has(k) && String(a[k]).toLowerCase() === String(b[k as keyof typeof b]).toLowerCase());
  return shared.length / Math.max(keysA.length, keysB.size);
}

/**
 * Score match confidence from individual signals.
 * Weights: attribute overlap 50%, embedding proximity 30%, fuzzy name match 20%.
 * @param attributeOverlap - 0-1 overlap fraction
 * @param embeddingProximity - 0-1 (1 = identical vectors)
 * @param fuzzyNameScore - 0-1 name similarity
 * @returns Composite confidence 0-1
 */
export function scoreMatchConfidence(
  attributeOverlap: number,
  embeddingProximity: number,
  fuzzyNameScore: number,
): number {
  return Math.min(1, attributeOverlap * 0.5 + embeddingProximity * 0.3 + fuzzyNameScore * 0.2);
}

/**
 * Compute fuzzy name similarity using character bigram overlap.
 * @param nameA - First entity name/label
 * @param nameB - Second entity name/label
 * @returns Similarity 0-1
 */
export function fuzzyNameSimilarity(nameA: string, nameB: string): number {
  if (!nameA || !nameB) return 0;
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const a = normalize(nameA);
  const b = normalize(nameB);
  if (a === b) return 1;

  const getBigrams = (s: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2));
    return bigrams;
  };

  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersection++;
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Generate human-readable reasons for a match suggestion.
 * @param attrOverlap - Attribute overlap score
 * @param embeddingProx - Embedding proximity score
 * @param fuzzyName - Fuzzy name similarity
 * @returns List of reason strings
 */
export function generateMatchReasons(attrOverlap: number, embeddingProx: number, fuzzyName: number): string[] {
  const reasons: string[] = [];
  if (attrOverlap > 0.6) reasons.push(`${Math.round(attrOverlap * 100)}% attribute overlap`);
  else if (attrOverlap > 0.3) reasons.push('Partial attribute overlap');
  if (embeddingProx > 0.8) reasons.push('High semantic similarity');
  if (fuzzyName > 0.7) reasons.push('Similar name/label');
  if (reasons.length === 0) reasons.push('Potential match detected');
  return reasons;
}

// ─── EntityReconciler ─────────────────────────────────────────────────────────

export class EntityReconciler {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Find cross-connector match candidates for an entity.
   * @param entityId - Source entity to match
   * @param topK - Maximum candidates to return
   * @returns Ranked match candidates from other connectors
   */
  async findMatchCandidates(entityId: string, topK = 5): Promise<Result<MatchCandidate[], Error>> {
    try {
      type SourceRow = { type: string; label: string; connector_id: string; attributes: Record<string, unknown> };
      const [source] = await this.sql<SourceRow[]>`
        SELECT type, label, connector_id, COALESCE(attributes, '{}')::jsonb AS attributes
        FROM iris_entities WHERE id = ${entityId}
      `;
      if (!source) return err(new Error(`Entity ${entityId} not found`));

      type CandidateRow = { id: string; label: string; connector_id: string; attributes: Record<string, unknown> };
      const candidates = await this.sql<CandidateRow[]>`
        SELECT id, label, connector_id, COALESCE(attributes, '{}')::jsonb AS attributes
        FROM iris_entities
        WHERE type = ${source.type}
          AND connector_id != ${source.connector_id}
          AND id != ${entityId}
        LIMIT ${topK * 3}
      `;

      const scored: MatchCandidate[] = candidates.map((c) => {
        const attrOverlap = computeAttributeOverlap(source.attributes, c.attributes);
        const fuzzyName = fuzzyNameSimilarity(source.label, c.label);
        const embeddingDist = 0.5; // placeholder — real impl queries vector store
        const confidence = scoreMatchConfidence(attrOverlap, 1 - embeddingDist, fuzzyName);
        return {
          candidateId: c.id,
          candidateConnector: c.connector_id,
          confidence,
          attributeOverlap: attrOverlap,
          embeddingDistance: embeddingDist,
          reasons: generateMatchReasons(attrOverlap, 1 - embeddingDist, fuzzyName),
        };
      });

      scored.sort((a, b) => b.confidence - a.confidence);
      return ok(scored.slice(0, topK));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Score match confidence between two specific entities.
   * @param entity1Id - First entity ID
   * @param entity2Id - Second entity ID
   */
  async scoreMatchConfidenceBetween(entity1Id: string, entity2Id: string): Promise<Result<{ confidence: number; breakdown: { attributeOverlap: number; embeddingProximity: number; fuzzyName: number } }, Error>> {
    try {
      type Row = { label: string; attributes: Record<string, unknown> };
      const rows = await this.sql<Row[]>`
        SELECT label, COALESCE(attributes, '{}')::jsonb AS attributes
        FROM iris_entities WHERE id = ANY(ARRAY[${entity1Id}, ${entity2Id}])
      `;
      if (rows.length < 2) return err(new Error('One or both entities not found'));
      const [e1, e2] = rows;
      const attrOverlap = computeAttributeOverlap(e1!.attributes, e2!.attributes);
      const fuzzyName = fuzzyNameSimilarity(e1!.label, e2!.label);
      const embeddingProximity = 0.5;
      return ok({
        confidence: scoreMatchConfidence(attrOverlap, embeddingProximity, fuzzyName),
        breakdown: { attributeOverlap: attrOverlap, embeddingProximity, fuzzyName },
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Suggest reconciliation action for a source entity against multiple candidates.
   * @param sourceId - Source entity
   * @param targetIds - Candidate target entity IDs
   */
  async suggestReconciliation(sourceId: string, targetIds: string[]): Promise<Result<ReconciliationSuggestion, Error>> {
    if (targetIds.length === 0) return err(new Error('targetIds must not be empty'));
    try {
      const candidatesResult = await this.findMatchCandidates(sourceId, 10);
      if (candidatesResult.isErr()) return err(candidatesResult.error);
      const allCandidates = candidatesResult.value.filter((c) => targetIds.includes(c.candidateId));
      const topConfidence = allCandidates[0]?.confidence ?? 0;
      let recommendedAction: ReconciliationDecision;
      if (topConfidence >= 0.85) recommendedAction = 'merge';
      else if (topConfidence >= 0.5) recommendedAction = 'link';
      else recommendedAction = 'reject';

      const mergeOrder = [sourceId, ...allCandidates.map((c) => c.candidateId)];
      return ok({ sourceId, candidates: allCandidates, recommendedAction, mergeOrder });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record a human's reconciliation decision for learning.
   * @param sourceId - Source entity
   * @param targetId - Target entity
   * @param decision - Human decision
   */
  async recordReconciliationDecision(
    sourceId: string,
    targetId: string,
    decision: ReconciliationDecision,
  ): Promise<Result<ReconciliationRecord, Error>> {
    try {
      const id = randomUUID();
      await this.sql`
        INSERT INTO reconciliation_records (id, source_id, target_id, decision, recorded_at)
        VALUES (${id}, ${sourceId}, ${targetId}, ${decision}, NOW())
        ON CONFLICT (source_id, target_id) DO UPDATE SET decision = EXCLUDED.decision, recorded_at = NOW()
      `;
      log.info('Reconciliation decision recorded', { sourceId, targetId, decision });
      return ok({ id, sourceId, targetId, decision, recordedAt: new Date() });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List pending reconciliation decisions (matches with no decision yet).
   */
  async listPendingReconciliations(): Promise<Result<{ sourceId: string; candidateId: string; confidence: number }[], Error>> {
    try {
      type Row = { source_id: string; candidate_id: string; confidence: number };
      const rows = await this.sql<Row[]>`
        SELECT em.source_id, em.candidate_id, em.confidence
        FROM entity_matches em
        LEFT JOIN reconciliation_records rr ON rr.source_id = em.source_id AND rr.target_id = em.candidate_id
        WHERE rr.id IS NULL
        ORDER BY em.confidence DESC
        LIMIT 50
      `;
      return ok(rows.map((r) => ({ sourceId: r.source_id, candidateId: r.candidate_id, confidence: r.confidence })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
