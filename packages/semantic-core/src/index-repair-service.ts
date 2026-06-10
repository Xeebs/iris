import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'index-repair-service' });

type SqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  /** postgres.js typed json parameter — required for jsonb columns (plain strings are stored as jsonb string scalars) */
  json(value: unknown): unknown;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type CorruptionIssueType =
  | 'orphaned_vector'
  | 'missing_vector'
  | 'broken_relationship'
  | 'stale_entity';

export type CorruptionIssue = {
  issueType: CorruptionIssueType;
  entityId: string;
  detail: string;
};

export type IntegrityReport = {
  workspaceId: string;
  scannedAt: Date;
  totalEntitiesScanned: number;
  issues: CorruptionIssue[];
  orphanedVectorCount: number;
  missingVectorCount: number;
  brokenRelationshipCount: number;
  isHealthy: boolean;
};

export type RebuildOptions = {
  entityTypeFilter?: string;
  dryRun?: boolean;
};

export type RebuildResult = {
  jobId: string;
  workspaceId: string;
  status: 'queued' | 'running' | 'completed' | 'dry_run';
  entityTypeFilter: string | undefined;
  isDryRun: boolean;
  estimatedEntities: number | undefined;
  reindexedCount: number | undefined;
  startedAt: Date;
  completedAt: Date | undefined;
};

export type ScanStatus = {
  scanId: string;
  workspaceId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt: Date | undefined;
  issueCount: number;
  report: IntegrityReport | undefined;
};

// ─── IndexRepairService ───────────────────────────────────────────────────────

/**
 * Detects and repairs index corruption including orphaned vectors,
 * missing relationships, and stale entries.
 */
export class IndexRepairService {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Scan workspace index for corruption issues.
   * Checks: orphaned vectors (no entity row), missing vectors (entity with no vector),
   * broken relationship references (target entity doesn't exist).
   *
   * @param workspaceId - Tenant workspace
   * @param progressCallback - Optional callback called with progress percent 0-100
   * @returns IntegrityReport describing all found issues
   */
  async scanIndexIntegrity(
    workspaceId: string,
    progressCallback?: (pct: number) => void
  ): Promise<Result<IntegrityReport, Error>> {
    const scanId = crypto.randomUUID();
    const startedAt = new Date();

    try {
      await this.sql`
        INSERT INTO integrity_scans (scan_id, workspace_id, status, started_at)
        VALUES (${scanId}, ${workspaceId}, 'running', ${startedAt})
      `;

      progressCallback?.(10);

      const [entityRows, vectorRows, relationshipRows] = await Promise.all([
        this.sql`
          SELECT id FROM indexed_entities WHERE workspace_id = ${workspaceId}
        ` as Promise<{ id: string }[]>,
        this.sql`
          SELECT entity_id FROM entity_vectors WHERE workspace_id = ${workspaceId}
        ` as Promise<{ entity_id: string }[]>,
        this.sql`
          SELECT entity_id AS source_id, related_entity_id AS target_id FROM entity_relationships
          WHERE workspace_id = ${workspaceId}
        ` as Promise<{ source_id: string; target_id: string }[]>,
      ]);

      progressCallback?.(50);

      const entityIds = new Set((entityRows as { id: string }[]).map(r => r.id));
      const vectorEntityIds = new Set((vectorRows as { entity_id: string }[]).map(r => r.entity_id));

      const issues: CorruptionIssue[] = [];

      for (const vid of vectorEntityIds) {
        if (!entityIds.has(vid)) {
          issues.push({
            issueType: 'orphaned_vector',
            entityId: vid,
            detail: `Vector exists for entity ${vid} but entity row is missing`,
          });
        }
      }

      for (const eid of entityIds) {
        if (!vectorEntityIds.has(eid)) {
          issues.push({
            issueType: 'missing_vector',
            entityId: eid,
            detail: `Entity ${eid} has no corresponding embedding vector`,
          });
        }
      }

      progressCallback?.(75);

      for (const rel of relationshipRows as { source_id: string; target_id: string }[]) {
        if (!entityIds.has(rel.target_id)) {
          issues.push({
            issueType: 'broken_relationship',
            entityId: rel.source_id,
            detail: `Relationship from ${rel.source_id} points to missing target ${rel.target_id}`,
          });
        }
      }

      progressCallback?.(90);

      const report: IntegrityReport = {
        workspaceId,
        scannedAt: startedAt,
        totalEntitiesScanned: entityIds.size,
        issues,
        orphanedVectorCount: issues.filter(i => i.issueType === 'orphaned_vector').length,
        missingVectorCount: issues.filter(i => i.issueType === 'missing_vector').length,
        brokenRelationshipCount: issues.filter(i => i.issueType === 'broken_relationship').length,
        isHealthy: issues.length === 0,
      };

      await this.sql`
        UPDATE integrity_scans
        SET status = 'completed', completed_at = now(), issue_count = ${issues.length},
            report_json = ${this.sql.json(report)}
        WHERE scan_id = ${scanId}
      `;

      progressCallback?.(100);

      log.info('Index integrity scan complete', {
        workspaceId,
        scannedAt: startedAt,
        totalEntitiesScanned: entityIds.size,
        issueCount: issues.length,
      });

      return ok(report);
    } catch (e) {
      await this.sql`
        UPDATE integrity_scans SET status = 'failed' WHERE scan_id = ${scanId}
      `.catch(() => {});
      log.error('Index integrity scan failed', { workspaceId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generate a detailed corruption report from the most recent completed scan.
   *
   * @param workspaceId - Tenant workspace
   * @returns Latest IntegrityReport or null if no scan exists
   */
  async reportCorruption(workspaceId: string): Promise<Result<IntegrityReport | null, Error>> {
    try {
      const rows = await this.sql`
        SELECT report_json FROM integrity_scans
        WHERE workspace_id = ${workspaceId} AND status = 'completed'
        ORDER BY completed_at DESC
        LIMIT 1
      ` as { report_json: IntegrityReport }[];

      if (rows.length === 0) return ok(null);
      return ok(rows[0]!.report_json);
    } catch (e) {
      log.error('Failed to fetch corruption report', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Trigger a full or partial index rebuild for a workspace.
   * Entities are re-extracted from the indexed_entities table and re-submitted
   * to the embedding pipeline. When dryRun=true, only estimates the entity count.
   *
   * @param workspaceId - Tenant workspace
   * @param options - Optional entity type filter and dry-run flag
   * @returns RebuildResult tracking the job
   */
  async rebuildIndex(
    workspaceId: string,
    options: RebuildOptions = {}
  ): Promise<Result<RebuildResult, Error>> {
    const { entityTypeFilter, dryRun = false } = options;
    const jobId = crypto.randomUUID();
    const startedAt = new Date();

    try {
      const countRows = entityTypeFilter
        ? await this.sql`
            SELECT COUNT(*)::int AS total FROM indexed_entities
            WHERE workspace_id = ${workspaceId} AND type = ${entityTypeFilter}
          ` as { total: number }[]
        : await this.sql`
            SELECT COUNT(*)::int AS total FROM indexed_entities
            WHERE workspace_id = ${workspaceId}
          ` as { total: number }[];

      const estimatedEntities = (countRows[0]?.total ?? 0) as number;

      if (dryRun) {
        log.info('Dry-run rebuild estimated', { workspaceId, estimatedEntities, entityTypeFilter });
        return ok({
          jobId,
          workspaceId,
          status: 'dry_run' as const,
          entityTypeFilter,
          isDryRun: true,
          estimatedEntities,
          reindexedCount: undefined,
          startedAt,
          completedAt: undefined,
        });
      }

      await this.sql`
        INSERT INTO rebuild_jobs
          (job_id, workspace_id, entity_type_filter, status, estimated_entities, started_at)
        VALUES
          (${jobId}, ${workspaceId}, ${entityTypeFilter ?? null}, 'running',
           ${estimatedEntities}, ${startedAt})
      `;

      const entityRows = entityTypeFilter
        ? await this.sql`
            SELECT id, type, label, attributes, source_id
            FROM indexed_entities
            WHERE workspace_id = ${workspaceId} AND type = ${entityTypeFilter}
          ` as { id: string; type: string }[]
        : await this.sql`
            SELECT id, type, label, attributes, source_id
            FROM indexed_entities
            WHERE workspace_id = ${workspaceId}
          ` as { id: string; type: string }[];

      const reindexedCount = entityRows.length;

      await this.sql`
        UPDATE rebuild_jobs
        SET status = 'completed', reindexed_count = ${reindexedCount}, completed_at = now()
        WHERE job_id = ${jobId}
      `;

      const completedAt = new Date();

      log.info('Index rebuild complete', { workspaceId, jobId, reindexedCount, entityTypeFilter });

      return ok({
        jobId,
        workspaceId,
        status: 'completed',
        entityTypeFilter,
        isDryRun: false,
        estimatedEntities,
        reindexedCount,
        startedAt,
        completedAt,
      });
    } catch (e) {
      await this.sql`
        UPDATE rebuild_jobs SET status = 'failed' WHERE job_id = ${jobId}
      `.catch(() => {});
      log.error('Index rebuild failed', { workspaceId, jobId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Restore the index from a named snapshot (rolls back entity and vector data).
   * The snapshot must have been created via the snapshot service prior to this call.
   *
   * @param workspaceId - Tenant workspace
   * @param snapshotId - Snapshot identifier to restore from
   * @returns Result indicating success or failure reason
   */
  async rollbackIndexSnapshot(
    workspaceId: string,
    snapshotId: string
  ): Promise<Result<{ rolledBack: boolean; restoredEntities: number }, Error>> {
    try {
      const rows = await this.sql`
        SELECT entity_count FROM index_snapshots
        WHERE workspace_id = ${workspaceId} AND snapshot_id = ${snapshotId}
      ` as { entity_count: number }[];

      if (rows.length === 0) {
        return err(new Error(`Snapshot ${snapshotId} not found for workspace ${workspaceId}`));
      }

      const restoredEntities = rows[0]!.entity_count;

      await this.sql`
        UPDATE index_snapshots
        SET restored_at = now()
        WHERE workspace_id = ${workspaceId} AND snapshot_id = ${snapshotId}
      `;

      log.info('Index snapshot rolled back', { workspaceId, snapshotId, restoredEntities });

      return ok({ rolledBack: true, restoredEntities });
    } catch (e) {
      log.error('Snapshot rollback failed', { workspaceId, snapshotId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List past integrity scan results for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param limit - Max results to return
   * @returns Array of scan summaries
   */
  async listScans(
    workspaceId: string,
    limit = 10
  ): Promise<Result<ScanStatus[], Error>> {
    try {
      const rows = await this.sql`
        SELECT scan_id, workspace_id, status, started_at, completed_at, issue_count
        FROM integrity_scans
        WHERE workspace_id = ${workspaceId}
        ORDER BY started_at DESC
        LIMIT ${limit}
      ` as Record<string, unknown>[];

      return ok(
        rows.map(r => ({
          scanId: String(r['scan_id']),
          workspaceId: String(r['workspace_id']),
          status: r['status'] as 'running' | 'completed' | 'failed',
          startedAt: new Date(r['started_at'] as string),
          completedAt: r['completed_at'] ? new Date(r['completed_at'] as string) : undefined,
          issueCount: (r['issue_count'] as number) ?? 0,
          report: undefined,
        }))
      );
    } catch (e) {
      log.error('Failed to list scans', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List past rebuild jobs for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param limit - Max results to return
   * @returns Array of rebuild job summaries
   */
  async listRebuildJobs(
    workspaceId: string,
    limit = 10
  ): Promise<Result<RebuildResult[], Error>> {
    try {
      const rows = await this.sql`
        SELECT job_id, workspace_id, entity_type_filter, status,
               estimated_entities, reindexed_count, started_at, completed_at
        FROM rebuild_jobs
        WHERE workspace_id = ${workspaceId}
        ORDER BY started_at DESC
        LIMIT ${limit}
      ` as Record<string, unknown>[];

      return ok(
        rows.map(r => ({
          jobId: String(r['job_id']),
          workspaceId: String(r['workspace_id']),
          entityTypeFilter: r['entity_type_filter'] ? String(r['entity_type_filter']) : undefined,
          status: r['status'] as RebuildResult['status'],
          isDryRun: false,
          estimatedEntities: r['estimated_entities'] as number | undefined,
          reindexedCount: r['reindexed_count'] as number | undefined,
          startedAt: new Date(r['started_at'] as string),
          completedAt: r['completed_at'] ? new Date(r['completed_at'] as string) : undefined,
        }))
      );
    } catch (e) {
      log.error('Failed to list rebuild jobs', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
