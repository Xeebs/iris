import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'entity-linker' });

// ─── Additional exported types ─────────────────────────────────────────────────

export type MergeRecord = {
  mergeId: string;
  workspaceId: string;
  sourceEntityId: string;
  targetEntityId: string;
  mergedBy: string;
  mergedAt: Date;
  undoneAt: Date | undefined;
};

// ─── Exported pure utilities ───────────────────────────────────────────────────

/**
 * Computes Levenshtein edit distance between two strings.
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

/**
 * Scores a candidate match between two entities.
 * Weights: name similarity (50%), email domain match (20%), attribute overlap (30%).
 * @param entityA - Source entity
 * @param entityB - Target entity
 * @returns Composite score 0–1 and signal breakdown
 */
export function scoreMatch(
  entityA: { label: string; email?: string | null; attributes?: Record<string, unknown> },
  entityB: { label: string; email?: string | null; attributes?: Record<string, unknown> },
): { score: number; nameScore: number; emailDomainMatch: boolean; attributeOverlap: number } {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const na = normalize(entityA.label);
  const nb = normalize(entityB.label);
  let nameScore = 0;
  if (na === nb) {
    nameScore = 1;
  } else {
    const maxLen = Math.max(na.length, nb.length);
    nameScore = maxLen === 0 ? 0 : 1 - levenshteinDistance(na, nb) / maxLen;
  }

  let emailDomainMatch = false;
  const domainOf = (e?: string | null) => {
    if (!e) return null;
    const idx = e.indexOf('@');
    return idx >= 0 ? e.slice(idx + 1).toLowerCase() : null;
  };
  const dA = domainOf(entityA.email);
  const dB = domainOf(entityB.email);
  if (dA && dB && dA === dB) emailDomainMatch = true;

  const attrsA = entityA.attributes ?? {};
  const attrsB = entityB.attributes ?? {};
  const keysA = Object.keys(attrsA).filter(k => attrsA[k] != null);
  const keysB = Object.keys(attrsB).filter(k => attrsB[k] != null);
  let attributeOverlap = 0;
  if (keysA.length > 0 || keysB.length > 0) {
    const intersection = keysA.filter(k => keysB.includes(k) && attrsA[k] === attrsB[k]).length;
    const union = new Set([...keysA, ...keysB]).size;
    attributeOverlap = union === 0 ? 0 : intersection / union;
  }

  const score = Math.min(nameScore * 0.5 + (emailDomainMatch ? 0.2 : 0) + attributeOverlap * 0.3, 1);
  return { score, nameScore, emailDomainMatch, attributeOverlap };
}

export type LinkStatus = 'proposed' | 'confirmed' | 'rejected';

export type EntityLink = {
  id: string;
  workspaceId: string;
  entityIdA: string;
  connectorA: string;
  entityIdB: string;
  connectorB: string;
  confidence: number;
  matchSignals: MatchSignals | null;
  status: LinkStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type MatchSignals = {
  nameSimilarity?: number;
  emailDomainMatch?: boolean;
  phoneMatch?: boolean;
  embeddingSimilarity?: number;
  compositeScore: number;
};

export type LinkProposal = {
  entityIdA: string;
  connectorA: string;
  entityIdB: string;
  connectorB: string;
  confidence: number;
  matchSignals: MatchSignals;
};

export type EntityRecord = {
  id: string;
  connector: string;
  label: string;
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
  embeddingVector?: number[] | null;
};

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

function mapLinkRow(r: Record<string, unknown>): EntityLink {
  const link: EntityLink = {
    id: r['id'] as string,
    workspaceId: r['workspace_id'] as string,
    entityIdA: r['entity_id_a'] as string,
    connectorA: r['connector_a'] as string,
    entityIdB: r['entity_id_b'] as string,
    connectorB: r['connector_b'] as string,
    confidence: r['confidence'] as number,
    matchSignals: null,
    status: r['status'] as LinkStatus,
    createdAt: new Date(r['created_at'] as string),
    updatedAt: new Date(r['updated_at'] as string),
  };
  if (r['match_signals'] != null) {
    link.matchSignals = r['match_signals'] as MatchSignals;
  }
  return link;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function nameSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  const longer = na.length > nb.length ? na : nb;
  const shorter = na.length > nb.length ? nb : na;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  // Jaro-Winkler approximation: 3-gram overlap
  const grams = (s: string, n: number) => new Set(Array.from({ length: s.length - n + 1 }, (_, i) => s.slice(i, i + n)));
  const ga = grams(na, 3);
  const gb = grams(nb, 3);
  const intersection = [...ga].filter((g) => gb.has(g)).length;
  return intersection === 0 ? 0 : (2 * intersection) / (ga.size + gb.size);
}

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const parts = email.split('@');
  return parts[1] ?? null;
}

/**
 * Analyzes and persists canonical entity links across connectors.
 * Uses fuzzy name matching, email domain matching, and embedding similarity.
 */
export class EntityLinker {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Proposes links between a set of entities from different connectors.
   * Computes confidence from multiple match signals.
   *
   * @param entities - Array of entity records from different connectors
   * @param threshold - Minimum confidence for a proposed link (default: 0.70)
   * @returns List of link proposals ordered by confidence
   */
  proposeLinks(entities: EntityRecord[], threshold = 0.70): LinkProposal[] {
    const proposals: LinkProposal[] = [];

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i]!;
        const b = entities[j]!;
        if (a.connector === b.connector) continue; // only cross-connector links

        const signals: MatchSignals = { compositeScore: 0 };

        const nameScore = nameSimilarity(a.label, b.label);
        signals.nameSimilarity = nameScore;

        const domainA = emailDomain(a.email) ?? a.domain;
        const domainB = emailDomain(b.email) ?? b.domain;
        if (domainA && domainB) {
          signals.emailDomainMatch = domainA === domainB;
        }

        if (a.phone && b.phone) {
          const normPhone = (p: string) => p.replace(/\D/g, '').slice(-10);
          signals.phoneMatch = normPhone(a.phone) === normPhone(b.phone);
        }

        let embeddingScore = 0;
        if (a.embeddingVector && b.embeddingVector) {
          embeddingScore = cosineSimilarity(a.embeddingVector, b.embeddingVector);
          signals.embeddingSimilarity = embeddingScore;
        }

        const composite = (
          nameScore * 0.40 +
          (signals.emailDomainMatch ? 0.30 : 0) +
          (signals.phoneMatch ? 0.20 : 0) +
          embeddingScore * 0.10
        );
        signals.compositeScore = Math.min(composite, 1);

        if (signals.compositeScore >= threshold) {
          proposals.push({
            entityIdA: a.id,
            connectorA: a.connector,
            entityIdB: b.id,
            connectorB: b.connector,
            confidence: signals.compositeScore,
            matchSignals: signals,
          });
        }
      }
    }

    return proposals.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Persists a confirmed or proposed link between two entities.
   *
   * @param workspaceId - Tenant workspace
   * @param proposal - Link proposal from proposeLinks()
   * @param status - Initial status (default: 'proposed')
   * @returns Created link record
   */
  async createLink(
    workspaceId: string,
    proposal: LinkProposal,
    status: LinkStatus = 'proposed',
  ): Promise<Result<EntityLink, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO entity_cross_connector_links
          (workspace_id, entity_id_a, connector_a, entity_id_b, connector_b, confidence, match_signals, status)
        VALUES
          (${workspaceId}, ${proposal.entityIdA}, ${proposal.connectorA},
           ${proposal.entityIdB}, ${proposal.connectorB}, ${proposal.confidence},
           ${JSON.stringify(proposal.matchSignals)}, ${status})
        ON CONFLICT (workspace_id, entity_id_a, entity_id_b)
        DO UPDATE SET
          confidence = EXCLUDED.confidence,
          match_signals = EXCLUDED.match_signals,
          updated_at = now()
        RETURNING id, workspace_id, entity_id_a, connector_a, entity_id_b, connector_b,
                  confidence, match_signals, status, created_at, updated_at
      ` as Record<string, unknown>[];
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));
      return ok(mapLinkRow(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Updates the status of an existing link (confirm or reject).
   *
   * @param workspaceId - Tenant workspace
   * @param linkId - Link to update
   * @param status - New status
   */
  async updateLinkStatus(
    workspaceId: string,
    linkId: string,
    status: LinkStatus,
  ): Promise<Result<EntityLink, Error>> {
    try {
      const rows = await this.sql`
        UPDATE entity_cross_connector_links
        SET status = ${status}, updated_at = now()
        WHERE id = ${linkId} AND workspace_id = ${workspaceId}
        RETURNING id, workspace_id, entity_id_a, connector_a, entity_id_b, connector_b,
                  confidence, match_signals, status, created_at, updated_at
      ` as Record<string, unknown>[];
      const row = rows[0];
      if (!row) return err(new Error('Link not found'));
      return ok(mapLinkRow(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns all links for a workspace, optionally filtered by status.
   *
   * @param workspaceId - Tenant workspace
   * @param status - Optional status filter
   * @param limit - Maximum number of links to return
   */
  async listLinks(
    workspaceId: string,
    status?: LinkStatus,
    limit = 50,
  ): Promise<Result<EntityLink[], Error>> {
    try {
      const rows = await this.sql`
        SELECT id, workspace_id, entity_id_a, connector_a, entity_id_b, connector_b,
               confidence, match_signals, status, created_at, updated_at
        FROM entity_cross_connector_links
        WHERE workspace_id = ${workspaceId}
          AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
        ORDER BY confidence DESC, created_at DESC
        LIMIT ${limit}
      ` as Record<string, unknown>[];
      return ok(rows.map(mapLinkRow));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Scans semantic_entities for cross-connector duplicates and persists proposals.
   * Returns count of new proposals created.
   *
   * @param workspaceId - Tenant workspace
   * @param entityType - Optional entity type to scope the analysis
   * @param threshold - Minimum confidence for proposed links
   */
  async analyzeEntityConnections(
    workspaceId: string,
    entityType?: string,
    threshold = 0.70,
  ): Promise<Result<number, Error>> {
    try {
      const rows = await this.sql`
        SELECT id, source_connector AS connector, label, attributes
        FROM semantic_entities
        WHERE workspace_id = ${workspaceId}
          AND (${entityType ?? null}::text IS NULL OR entity_type = ${entityType ?? null})
        ORDER BY source_connector, label
        LIMIT 1000
      ` as { id: string; connector: string; label: string; attributes: Record<string, unknown> }[];

      const entities: EntityRecord[] = rows.map((r) => ({
        id: r.id,
        connector: r.connector,
        label: r.label,
        email: r.attributes['email'] as string | null,
        phone: r.attributes['phone'] as string | null,
        domain: r.attributes['domain'] as string | null,
      }));

      const proposals = this.proposeLinks(entities, threshold);
      let created = 0;

      for (const proposal of proposals) {
        const result = await this.createLink(workspaceId, proposal, 'proposed');
        if (result.isOk()) created++;
      }

      log.info('Entity linking analysis complete', { workspaceId, entityType, proposals: proposals.length, created });
      return ok(created);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Confirms a merge between two entities, recording audit trail in entity_merges.
   * Also updates the link status to 'confirmed' if a link record exists.
   *
   * @param sourceEntityId - Entity to merge from
   * @param targetEntityId - Entity to merge into
   * @param workspaceId - Tenant workspace
   * @param mergedBy - Actor identifier
   * @returns Created merge record ID
   */
  async confirmMerge(
    sourceEntityId: string,
    targetEntityId: string,
    workspaceId: string,
    mergedBy: string,
  ): Promise<Result<string, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO entity_merges (source_entity_id, target_entity_id, workspace_id, merged_by)
        VALUES (${sourceEntityId}, ${targetEntityId}, ${workspaceId}, ${mergedBy})
        RETURNING merge_id
      ` as unknown as { merge_id: string }[];

      if (rows.length === 0) return err(new Error('Merge insert returned no rows'));

      await this.sql`
        UPDATE entity_cross_connector_links
        SET status = 'confirmed', updated_at = now()
        WHERE workspace_id = ${workspaceId}
          AND ((entity_id_a = ${sourceEntityId} AND entity_id_b = ${targetEntityId})
            OR (entity_id_a = ${targetEntityId} AND entity_id_b = ${sourceEntityId}))
      `;

      log.info('Entity merge confirmed', { sourceEntityId, targetEntityId, workspaceId, mergedBy });
      return ok(rows[0]!.merge_id);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Undoes a confirmed merge by recording the undo timestamp.
   *
   * @param mergeId - Merge record to undo
   * @param workspaceId - Tenant workspace
   */
  async undoMerge(mergeId: string, workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE entity_merges
        SET undone_at = now()
        WHERE merge_id = ${mergeId} AND workspace_id = ${workspaceId} AND undone_at IS NULL
      `;
      log.info('Merge undone', { mergeId, workspaceId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns the merge audit trail for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param limit - Maximum records to return
   */
  async getMergeHistory(workspaceId: string, limit = 50): Promise<Result<MergeRecord[], Error>> {
    try {
      const rows = await this.sql`
        SELECT merge_id, workspace_id, source_entity_id, target_entity_id,
               merged_by, merged_at, undone_at
        FROM entity_merges
        WHERE workspace_id = ${workspaceId}
        ORDER BY merged_at DESC
        LIMIT ${limit}
      ` as unknown as {
        merge_id: string; workspace_id: string; source_entity_id: string;
        target_entity_id: string; merged_by: string; merged_at: string; undone_at: string | null;
      }[];

      return ok(rows.map(r => ({
        mergeId: r.merge_id,
        workspaceId: r.workspace_id,
        sourceEntityId: r.source_entity_id,
        targetEntityId: r.target_entity_id,
        mergedBy: r.merged_by,
        mergedAt: new Date(r.merged_at),
        undoneAt: r.undone_at ? new Date(r.undone_at) : undefined,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
