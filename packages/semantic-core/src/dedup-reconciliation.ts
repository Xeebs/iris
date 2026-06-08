import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'dedup-reconciliation' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type DedupDecision = 'merge' | 'keep_separate' | 'ignore';
export type DedupCandidateStatus = 'pending' | 'reviewed' | 'merged' | 'undone';

export interface DedupCandidate {
  id: string;
  workspaceId: string;
  sourceEntityId: string;
  candidateDuplicateId: string;
  similarityScore: number;
  detectedAt: string;
  status: DedupCandidateStatus;
  decision: DedupDecision | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface DedupDecisionInput {
  workspaceId: string;
  sourceEntityId: string;
  candidateDuplicateId: string;
  decision: DedupDecision;
  decidedBy: string;
}

export interface MergeResult {
  survivingEntityId: string;
  mergedEntityId: string;
  mergedAt: string;
}

export interface DedupMetrics {
  totalCandidates: number;
  pendingReview: number;
  merged: number;
  keptSeparate: number;
  ignored: number;
  mergeSuccessRate: number;
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  workspace_id: string;
  source_entity_id: string;
  candidate_duplicate_id: string;
  similarity_score: string;
  detected_at: string;
  status: DedupCandidateStatus;
  decision: DedupDecision | null;
  decided_by: string | null;
  decided_at: string | null;
}

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

function rowToCandidate(r: CandidateRow): DedupCandidate {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    sourceEntityId: r.source_entity_id,
    candidateDuplicateId: r.candidate_duplicate_id,
    similarityScore: parseFloat(r.similarity_score),
    detectedAt: r.detected_at,
    status: r.status,
    decision: r.decision,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of entity deduplication candidates: detection, batch
 * review, merge decisions, and 30-day undo capability.
 */
export class DedupReconciliationService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Insert or update a dedup candidate pair detected by the embedding engine.
   *
   * @param workspaceId          - Target workspace
   * @param sourceEntityId       - One entity in the pair
   * @param candidateDuplicateId - The other entity
   * @param similarityScore      - Cosine similarity [0, 1]
   */
  async upsertCandidate(
    workspaceId: string,
    sourceEntityId: string,
    candidateDuplicateId: string,
    similarityScore: number,
  ): Promise<Result<DedupCandidate, Error>> {
    try {
      const [row] = await this.sql`
        INSERT INTO dedup_candidates
          (workspace_id, source_entity_id, candidate_duplicate_id, similarity_score, status)
        VALUES (
          ${workspaceId}, ${sourceEntityId}, ${candidateDuplicateId},
          ${similarityScore}, 'pending'
        )
        ON CONFLICT (workspace_id, source_entity_id, candidate_duplicate_id) DO UPDATE SET
          similarity_score = EXCLUDED.similarity_score,
          status = CASE
            WHEN dedup_candidates.status = 'pending' THEN 'pending'
            ELSE dedup_candidates.status
          END
        RETURNING *
      ` as CandidateRow[];

      if (!row) return err(new Error('Upsert returned no row'));
      log.debug('Dedup candidate upserted', { workspaceId, sourceEntityId, similarityScore });
      return ok(rowToCandidate(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List dedup candidates for a workspace, optionally filtered by status.
   *
   * @param workspaceId - Target workspace
   * @param status      - Filter by status (default: pending only)
   * @param limit       - Page size (default: 50)
   * @param cursor      - Opaque cursor for pagination
   */
  async listCandidates(
    workspaceId: string,
    status: DedupCandidateStatus = 'pending',
    limit = 50,
    cursor?: string,
  ): Promise<Result<DedupCandidate[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM dedup_candidates
        WHERE workspace_id = ${workspaceId}
          AND status = ${status}
          ${cursor ? this.sql`AND id > ${cursor}` : this.sql``}
        ORDER BY similarity_score DESC, id
        LIMIT ${limit}
      ` as CandidateRow[];
      return ok(rows.map(rowToCandidate));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record a reconciliation decision for a candidate pair.
   * Sets status to 'reviewed' and stores the decision.
   *
   * @param input - Decision details
   */
  async recordDecision(input: DedupDecisionInput): Promise<Result<DedupCandidate, Error>> {
    try {
      const [row] = await this.sql`
        UPDATE dedup_candidates
        SET status    = 'reviewed',
            decision  = ${input.decision},
            decided_by = ${input.decidedBy},
            decided_at = NOW()
        WHERE workspace_id        = ${input.workspaceId}
          AND source_entity_id   = ${input.sourceEntityId}
          AND candidate_duplicate_id = ${input.candidateDuplicateId}
          AND status = 'pending'
        RETURNING *
      ` as CandidateRow[];

      if (!row) return err(new Error('Candidate not found or already reviewed'));
      log.info('Dedup decision recorded', {
        workspaceId: input.workspaceId,
        sourceEntityId: input.sourceEntityId,
        decision: input.decision,
        decidedBy: input.decidedBy,
      });
      return ok(rowToCandidate(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Execute a merge: marks the candidate as merged and records the surviving entity.
   * The caller is responsible for actually combining entity data in the vector store.
   * Merge is reversible within 30 days via undoMerge().
   *
   * @param workspaceId          - Target workspace
   * @param sourceEntityId       - Entity to keep (survivor)
   * @param candidateDuplicateId - Entity to merge into survivor
   * @param mergedBy             - User executing the merge
   */
  async executeMerge(
    workspaceId: string,
    sourceEntityId: string,
    candidateDuplicateId: string,
    mergedBy: string,
  ): Promise<Result<MergeResult, Error>> {
    try {
      const [row] = await this.sql`
        UPDATE dedup_candidates
        SET status     = 'merged',
            decision   = 'merge',
            decided_by = ${mergedBy},
            decided_at = NOW()
        WHERE workspace_id            = ${workspaceId}
          AND source_entity_id       = ${sourceEntityId}
          AND candidate_duplicate_id = ${candidateDuplicateId}
          AND status IN ('pending', 'reviewed')
        RETURNING *
      ` as CandidateRow[];

      if (!row) return err(new Error('Candidate not found or not in mergeable state'));

      await this.sql`
        INSERT INTO entity_merge_log
          (workspace_id, surviving_entity_id, merged_entity_id, merged_by, merged_at)
        VALUES (${workspaceId}, ${sourceEntityId}, ${candidateDuplicateId}, ${mergedBy}, NOW())
        ON CONFLICT DO NOTHING
      `;

      log.info('Entity merge executed', { workspaceId, sourceEntityId, candidateDuplicateId, mergedBy });
      return ok({
        survivingEntityId: sourceEntityId,
        mergedEntityId: candidateDuplicateId,
        mergedAt: new Date().toISOString(),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Undo a previously executed merge (available within 30 days).
   * Restores the candidate to 'pending' and removes the merge log entry.
   *
   * @param workspaceId          - Target workspace
   * @param sourceEntityId       - Surviving entity
   * @param candidateDuplicateId - Entity that was merged
   */
  async undoMerge(
    workspaceId: string,
    sourceEntityId: string,
    candidateDuplicateId: string,
  ): Promise<Result<void, Error>> {
    try {
      const [logRow] = await this.sql`
        SELECT merged_at FROM entity_merge_log
        WHERE workspace_id        = ${workspaceId}
          AND surviving_entity_id = ${sourceEntityId}
          AND merged_entity_id    = ${candidateDuplicateId}
          AND merged_at > NOW() - INTERVAL '30 days'
      ` as Array<{ merged_at: string }>;

      if (!logRow) {
        return err(new Error('Merge not found or undo window expired (30 days)'));
      }

      await this.sql`
        UPDATE dedup_candidates
        SET status = 'undone', decision = NULL, decided_by = NULL, decided_at = NULL
        WHERE workspace_id            = ${workspaceId}
          AND source_entity_id       = ${sourceEntityId}
          AND candidate_duplicate_id = ${candidateDuplicateId}
      `;

      await this.sql`
        DELETE FROM entity_merge_log
        WHERE workspace_id        = ${workspaceId}
          AND surviving_entity_id = ${sourceEntityId}
          AND merged_entity_id    = ${candidateDuplicateId}
      `;

      log.info('Entity merge undone', { workspaceId, sourceEntityId, candidateDuplicateId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compute dedup metrics for a workspace.
   *
   * @param workspaceId - Target workspace
   */
  async getMetrics(workspaceId: string): Promise<Result<DedupMetrics, Error>> {
    try {
      const [row] = await this.sql`
        SELECT
          COUNT(*)                                          AS total_candidates,
          COUNT(*) FILTER (WHERE status = 'pending')       AS pending_review,
          COUNT(*) FILTER (WHERE status = 'merged')        AS merged,
          COUNT(*) FILTER (WHERE decision = 'keep_separate') AS kept_separate,
          COUNT(*) FILTER (WHERE decision = 'ignore')      AS ignored
        FROM dedup_candidates
        WHERE workspace_id = ${workspaceId}
      ` as Array<{
        total_candidates: string;
        pending_review: string;
        merged: string;
        kept_separate: string;
        ignored: string;
      }>;

      const r = row ?? { total_candidates: '0', pending_review: '0', merged: '0', kept_separate: '0', ignored: '0' };
      const total = parseInt(r.total_candidates, 10);
      const merged = parseInt(r.merged, 10);
      const reviewed = merged + parseInt(r.kept_separate, 10) + parseInt(r.ignored, 10);

      return ok({
        totalCandidates: total,
        pendingReview: parseInt(r.pending_review, 10),
        merged,
        keptSeparate: parseInt(r.kept_separate, 10),
        ignored: parseInt(r.ignored, 10),
        mergeSuccessRate: reviewed > 0 ? merged / reviewed : 0,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
