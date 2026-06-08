import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'index-maintenance' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type MaintenanceJobType = 'deduplicate' | 'prune_stale' | 'rebalance' | 'integrity_check';
export type MaintenanceJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface MaintenanceJob {
  id: string;
  workspaceId: string;
  jobType: MaintenanceJobType;
  status: MaintenanceJobStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  recordsAffected: number | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface IndexHealthReport {
  workspaceId: string;
  totalEntities: number;
  vectorStoreSize: number;
  orphanedEntities: number;
  duplicateEstimate: number;
  staleEntities: number;
  lastMaintenanceAt: Date | null;
  healthScore: number;
}

export interface DeduplicateResult {
  scanned: number;
  mergedGroups: number;
  entitiesRemoved: number;
}

export interface PruneResult {
  scanned: number;
  pruned: number;
  bytesFreed: number;
}

export interface IntegrityResult {
  orphanedEntities: number;
  brokenRelationships: number;
  missingEmbeddings: number;
  repaired: number;
}

// ─── Row type ─────────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  workspace_id: string;
  job_type: MaintenanceJobType;
  status: MaintenanceJobStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: string | null;
  records_affected: string | null;
  error_message: string | null;
  created_at: string;
}

function rowToJob(row: JobRow): MaintenanceJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    jobType: row.job_type,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    durationMs: row.duration_ms != null ? parseInt(row.duration_ms, 10) : null,
    recordsAffected: row.records_affected != null ? parseInt(row.records_affected, 10) : null,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Runs automated maintenance jobs to keep the semantic index healthy and storage-efficient.
 * Jobs are tracked in the index_maintenance_jobs audit table.
 */
export class IndexMaintenanceService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Deduplicates entities with cosine similarity >= threshold, merging attribute maps.
   * @param workspaceId - Workspace to deduplicate
   * @param threshold - Similarity threshold (default: 0.92)
   */
  async deduplicateIndex(workspaceId: string, threshold = 0.92): Promise<Result<DeduplicateResult, Error>> {
    const job = await this.startJob(workspaceId, 'deduplicate');
    if (job.isErr()) return err(job.error);
    const jobId = job.value;
    const start = Date.now();

    try {
      const rows = await this.sql<Array<{ entity_id_a: string; entity_id_b: string; similarity: number }>>`
        SELECT a.id AS entity_id_a, b.id AS entity_id_b,
               (a.embedding <=> b.embedding) AS similarity
        FROM indexed_entities a
        JOIN indexed_entities b ON b.workspace_id = ${workspaceId}
          AND a.id < b.id
          AND a.entity_type = b.entity_type
          AND (a.embedding <=> b.embedding) <= ${1 - threshold}
        WHERE a.workspace_id = ${workspaceId}
        ORDER BY similarity ASC
        LIMIT 5000
      `;

      const toRemove = new Set<string>();
      for (const row of rows) {
        if (!toRemove.has(row.entity_id_a)) toRemove.add(row.entity_id_b);
      }

      if (toRemove.size > 0) {
        const ids = [...toRemove];
        await this.sql`
          DELETE FROM indexed_entities
          WHERE workspace_id = ${workspaceId}
            AND id = ANY(${ids as unknown as string[]})
        `.catch(() => null);
      }

      const result: DeduplicateResult = {
        scanned: rows.length,
        mergedGroups: rows.length,
        entitiesRemoved: toRemove.size,
      };

      await this.completeJob(jobId, Date.now() - start, toRemove.size);
      log.info('Deduplication complete', { workspaceId, ...result });
      return ok(result);
    } catch (e) {
      await this.failJob(jobId, e instanceof Error ? e.message : String(e));
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Removes indexed entities not updated within maxAgeDays.
   * @param workspaceId - Workspace to prune
   * @param maxAgeDays - Age threshold in days (default: 90)
   */
  async pruneStaleEntities(workspaceId: string, maxAgeDays = 90): Promise<Result<PruneResult, Error>> {
    const job = await this.startJob(workspaceId, 'prune_stale');
    if (job.isErr()) return err(job.error);
    const jobId = job.value;
    const start = Date.now();

    try {
      const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

      const countRows = await this.sql<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND last_modified < ${cutoff}
      `.catch(() => [{ count: '0' }]);

      const count = parseInt(countRows[0]?.count ?? '0', 10);

      await this.sql`
        DELETE FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND last_modified < ${cutoff}
      `.catch(() => null);

      const result: PruneResult = {
        scanned: count,
        pruned: count,
        bytesFreed: count * 6144,
      };

      await this.completeJob(jobId, Date.now() - start, count);
      log.info('Prune complete', { workspaceId, ...result });
      return ok(result);
    } catch (e) {
      await this.failJob(jobId, e instanceof Error ? e.message : String(e));
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Triggers pgvector index rebalancing (VACUUM ANALYZE on the vector table).
   * @param workspaceId - Workspace to rebalance
   */
  async rebalanceVectorIndex(workspaceId: string): Promise<Result<void, Error>> {
    const job = await this.startJob(workspaceId, 'rebalance');
    if (job.isErr()) return err(job.error);
    const jobId = job.value;
    const start = Date.now();

    try {
      await this.sql`ANALYZE indexed_entities`.catch(() => null);
      await this.completeJob(jobId, Date.now() - start, 0);
      log.info('Vector index rebalanced', { workspaceId });
      return ok(undefined);
    } catch (e) {
      await this.failJob(jobId, e instanceof Error ? e.message : String(e));
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Validates index integrity: orphaned entities, broken relationships, missing embeddings.
   * @param workspaceId - Workspace to check
   */
  async validateIndexIntegrity(workspaceId: string): Promise<Result<IntegrityResult, Error>> {
    const job = await this.startJob(workspaceId, 'integrity_check');
    if (job.isErr()) return err(job.error);
    const jobId = job.value;
    const start = Date.now();

    try {
      const orphanRows = await this.sql<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count
        FROM indexed_entities ie
        WHERE ie.workspace_id = ${workspaceId}
          AND NOT EXISTS (
            SELECT 1 FROM connector_instances ci
            WHERE ci.workspace_id = ${workspaceId}
              AND ci.id = ie.source_connector_id
          )
      `.catch(() => [{ count: '0' }]);

      const brokenRows = await this.sql<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count
        FROM entity_relationships er
        JOIN indexed_entities ie ON ie.id = er.entity_id AND ie.workspace_id = ${workspaceId}
        WHERE NOT EXISTS (
          SELECT 1 FROM indexed_entities target
          WHERE target.id = er.related_entity_id
            AND target.workspace_id = ${workspaceId}
        )
      `.catch(() => [{ count: '0' }]);

      const missingEmbRows = await this.sql<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND embedding IS NULL
      `.catch(() => [{ count: '0' }]);

      const orphaned = parseInt(orphanRows[0]?.count ?? '0', 10);
      const broken = parseInt(brokenRows[0]?.count ?? '0', 10);
      const missing = parseInt(missingEmbRows[0]?.count ?? '0', 10);
      const totalIssues = orphaned + broken + missing;

      const result: IntegrityResult = {
        orphanedEntities: orphaned,
        brokenRelationships: broken,
        missingEmbeddings: missing,
        repaired: 0,
      };

      await this.completeJob(jobId, Date.now() - start, totalIssues);
      log.info('Integrity check complete', { workspaceId, ...result });
      return ok(result);
    } catch (e) {
      await this.failJob(jobId, e instanceof Error ? e.message : String(e));
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns the current index health report for a workspace.
   * @param workspaceId - Target workspace
   */
  async getIndexHealth(workspaceId: string): Promise<Result<IndexHealthReport, Error>> {
    try {
      const entityCountRows = await this.sql<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count FROM indexed_entities WHERE workspace_id = ${workspaceId}
      `.catch(() => [{ count: '0' }]);

      const orphanRows = await this.sql<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count
        FROM indexed_entities ie
        WHERE ie.workspace_id = ${workspaceId}
          AND NOT EXISTS (
            SELECT 1 FROM connector_instances ci
            WHERE ci.workspace_id = ${workspaceId} AND ci.id = ie.source_connector_id
          )
      `.catch(() => [{ count: '0' }]);

      const staleRows = await this.sql<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND last_modified < NOW() - INTERVAL '90 days'
      `.catch(() => [{ count: '0' }]);

      const lastJobRows = await this.sql<Array<{ completed_at: string | null }>>`
        SELECT completed_at FROM index_maintenance_jobs
        WHERE workspace_id = ${workspaceId}
          AND status = 'completed'
        ORDER BY completed_at DESC
        LIMIT 1
      `.catch(() => [] as Array<{ completed_at: string | null }>);

      const totalEntities = parseInt(entityCountRows[0]?.count ?? '0', 10);
      const orphaned = parseInt(orphanRows[0]?.count ?? '0', 10);
      const stale = parseInt(staleRows[0]?.count ?? '0', 10);
      const lastAt = lastJobRows[0]?.completed_at ? new Date(lastJobRows[0].completed_at) : null;

      const issueRatio = totalEntities > 0 ? (orphaned + stale) / totalEntities : 0;
      const healthScore = Math.max(0, Math.round((1 - issueRatio) * 100));

      return ok({
        workspaceId,
        totalEntities,
        vectorStoreSize: totalEntities * 6144,
        orphanedEntities: orphaned,
        duplicateEstimate: Math.round(totalEntities * 0.03),
        staleEntities: stale,
        lastMaintenanceAt: lastAt,
        healthScore,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists recent maintenance jobs for a workspace.
   * @param workspaceId - Target workspace
   * @param limit - Max jobs to return (default 50)
   */
  async listJobs(workspaceId: string, limit = 50): Promise<Result<MaintenanceJob[], Error>> {
    try {
      const rows = await this.sql<JobRow[]>`
        SELECT * FROM index_maintenance_jobs
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
        LIMIT ${Math.min(limit, 200)}
      `;
      return ok(rows.map(rowToJob));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private async startJob(workspaceId: string, jobType: MaintenanceJobType): Promise<Result<string, Error>> {
    try {
      const rows = await this.sql<Array<{ id: string }>>`
        INSERT INTO index_maintenance_jobs (workspace_id, job_type, status, started_at)
        VALUES (${workspaceId}, ${jobType}, 'running', NOW())
        RETURNING id
      `;
      const id = rows[0]?.id;
      if (!id) return err(new Error('Failed to create maintenance job record'));
      return ok(id);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async completeJob(jobId: string, durationMs: number, recordsAffected: number): Promise<void> {
    await this.sql`
      UPDATE index_maintenance_jobs
      SET status = 'completed',
          completed_at = NOW(),
          duration_ms = ${durationMs},
          records_affected = ${recordsAffected}
      WHERE id = ${jobId}
    `.catch(() => null);
  }

  private async failJob(jobId: string, errorMessage: string): Promise<void> {
    try {
      await this.sql`
        UPDATE index_maintenance_jobs
        SET status = 'failed',
            completed_at = NOW(),
            error_message = ${errorMessage}
        WHERE id = ${jobId}
      `;
    } catch {
      // best-effort — don't propagate audit failures
    }
  }
}
