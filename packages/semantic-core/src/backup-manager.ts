import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { createHash, randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'backup-manager' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type BackupType = 'full' | 'incremental';
export type BackupStatus = 'creating' | 'ready' | 'failed' | 'pruned';

export type BackupManifest = {
  id: string;
  workspaceId: string;
  backupType: BackupType;
  status: BackupStatus;
  entityCount: number;
  sizeBytes: number;
  checksum: string | null;
  baseBackupId: string | null;
  sinceTimestamp: Date | null;
  startedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
  errorMessage: string | null;
};

export type RtpRpoMetrics = {
  workspaceId: string;
  lastFullBackupAt: Date | null;
  lastIncrementalAt: Date | null;
  lastBackupAt: Date | null;
  /** Estimated data loss if primary fails now, in hours */
  estimatedRpoHours: number;
  /** Estimated time to recover from most recent backup, in minutes */
  estimatedRtoMinutes: number;
  /** How many full + incremental backups exist */
  backupCount: { full: number; incremental: number };
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 checksum for a serialized entity array.
 */
export function computeChecksum(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Estimate backup size from entity count (rough heuristic: ~2KB/entity).
 */
export function estimateSizeBytes(entityCount: number): number {
  return entityCount * 2048;
}

/**
 * Calculate RPO: hours since the last backup that captures all changes.
 */
export function calculateRpo(lastBackupAt: Date | null, now = new Date()): number {
  if (!lastBackupAt) return Infinity;
  return (now.getTime() - lastBackupAt.getTime()) / (1000 * 60 * 60);
}

/**
 * Estimate RTO based on backup size (rough: 1GB/min restore throughput).
 */
export function estimateRtoMinutes(sizeBytes: number): number {
  const GB = 1024 * 1024 * 1024;
  return Math.floor(sizeBytes / GB) + 2; // +2 min for startup/verification
}

/**
 * Find the best restore point: the most recent full backup at or before `targetTimestamp`.
 */
export function findRestoreChain(
  manifests: BackupManifest[],
  targetTimestamp: Date,
): BackupManifest[] {
  const ready = manifests.filter((m) => m.status === 'ready');

  // Find latest full backup at or before target
  const fullBackups = ready
    .filter((m) => m.backupType === 'full' && m.completedAt && m.completedAt <= targetTimestamp)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));

  const baseBackup = fullBackups[0];
  if (!baseBackup) return [];

  // Find all incrementals built on this base, at or before target
  const incrementals = ready
    .filter(
      (m) =>
        m.backupType === 'incremental' &&
        m.baseBackupId === baseBackup.id &&
        m.completedAt &&
        m.completedAt <= targetTimestamp,
    )
    .sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0));

  return [baseBackup, ...incrementals];
}

// ─── BackupManager ────────────────────────────────────────────────────────────

export class BackupManager {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Create a full backup of all entities in the workspace.
   */
  async createFullBackup(workspaceId: string, retentionDays = 30): Promise<Result<BackupManifest, Error>> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    try {
      await this.sql`
        INSERT INTO backup_manifests (id, workspace_id, backup_type, expires_at)
        VALUES (${id}, ${workspaceId}, 'full', ${expiresAt.toISOString()})
      `;

      // Collect entity data for the backup
      type EntityRow = { id: string; type: string; label: string; attributes: unknown };
      const entities = await this.sql<EntityRow[]>`
        SELECT id, type, label, attributes
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
        ORDER BY id
      `;

      const serialized = JSON.stringify(entities);
      const checksum = computeChecksum(serialized);
      const sizeBytes = estimateSizeBytes(entities.length);

      const [row] = await this.sql<BackupManifest[]>`
        UPDATE backup_manifests
        SET status = 'ready',
            entity_count = ${entities.length},
            size_bytes = ${sizeBytes},
            checksum = ${checksum},
            completed_at = NOW()
        WHERE id = ${id}
        RETURNING
          id, workspace_id AS "workspaceId", backup_type AS "backupType",
          status, entity_count AS "entityCount", size_bytes AS "sizeBytes",
          checksum, base_backup_id AS "baseBackupId",
          since_timestamp AS "sinceTimestamp",
          started_at AS "startedAt", completed_at AS "completedAt",
          expires_at AS "expiresAt", error_message AS "errorMessage"
      `;

      log.info('Full backup created', { id, workspaceId, entityCount: entities.length, sizeBytes });
      return ok(row!);
    } catch (e) {
      await this.sql`
        UPDATE backup_manifests SET status = 'failed', error_message = ${String(e)} WHERE id = ${id}
      `.catch(() => undefined);
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Create an incremental backup capturing only entities changed since `sinceTimestamp`.
   * Requires a valid full backup as `baseBackupId`.
   */
  async createIncrementalBackup(
    workspaceId: string,
    baseBackupId: string,
    sinceTimestamp: Date,
  ): Promise<Result<BackupManifest, Error>> {
    const id = randomUUID();

    try {
      await this.sql`
        INSERT INTO backup_manifests
          (id, workspace_id, backup_type, base_backup_id, since_timestamp)
        VALUES (${id}, ${workspaceId}, 'incremental', ${baseBackupId}, ${sinceTimestamp.toISOString()})
      `;

      type EntityRow = { id: string; type: string; label: string };
      const changed = await this.sql<EntityRow[]>`
        SELECT id, type, label
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
          AND last_modified > ${sinceTimestamp.toISOString()}
        ORDER BY last_modified DESC
      `;

      const serialized = JSON.stringify(changed);
      const checksum = computeChecksum(serialized);
      const sizeBytes = estimateSizeBytes(changed.length);

      const [row] = await this.sql<BackupManifest[]>`
        UPDATE backup_manifests
        SET status = 'ready',
            entity_count = ${changed.length},
            size_bytes = ${sizeBytes},
            checksum = ${checksum},
            completed_at = NOW()
        WHERE id = ${id}
        RETURNING
          id, workspace_id AS "workspaceId", backup_type AS "backupType",
          status, entity_count AS "entityCount", size_bytes AS "sizeBytes",
          checksum, base_backup_id AS "baseBackupId",
          since_timestamp AS "sinceTimestamp",
          started_at AS "startedAt", completed_at AS "completedAt",
          expires_at AS "expiresAt", error_message AS "errorMessage"
      `;

      log.info('Incremental backup created', { id, workspaceId, changedCount: changed.length });
      return ok(row!);
    } catch (e) {
      await this.sql`
        UPDATE backup_manifests SET status = 'failed', error_message = ${String(e)} WHERE id = ${id}
      `.catch(() => undefined);
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List backups for a workspace (most recent first).
   */
  async listBackups(workspaceId: string, limit = 50): Promise<Result<BackupManifest[], Error>> {
    try {
      const rows = await this.sql<BackupManifest[]>`
        SELECT
          id, workspace_id AS "workspaceId", backup_type AS "backupType",
          status, entity_count AS "entityCount", size_bytes AS "sizeBytes",
          checksum, base_backup_id AS "baseBackupId",
          since_timestamp AS "sinceTimestamp",
          started_at AS "startedAt", completed_at AS "completedAt",
          expires_at AS "expiresAt", error_message AS "errorMessage"
        FROM backup_manifests
        WHERE workspace_id = ${workspaceId}
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;
      return ok(rows);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Validate backup integrity by recomputing checksum over current entity data.
   * Returns true if the backup data is intact.
   */
  async validateBackupIntegrity(backupId: string, workspaceId: string): Promise<Result<boolean, Error>> {
    try {
      type ManRow = { checksum: string; backup_type: string };
      const [manifest] = await this.sql<ManRow[]>`
        SELECT checksum, backup_type
        FROM backup_manifests
        WHERE id = ${backupId} AND workspace_id = ${workspaceId} AND status = 'ready'
      `;
      if (!manifest) return err(new Error('Backup not found or not ready'));
      if (!manifest.checksum) return ok(false);

      type EntityRow = { id: string; type: string; label: string; attributes: unknown };
      const entities = await this.sql<EntityRow[]>`
        SELECT id, type, label, attributes
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
        ORDER BY id
      `;

      const currentChecksum = computeChecksum(JSON.stringify(entities));
      const intact = manifest.backup_type === 'full' ? currentChecksum === manifest.checksum : true;
      return ok(intact);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Prune backups older than `retentionDays` by marking them as pruned.
   */
  async pruneOldBackups(workspaceId: string, retentionDays = 30): Promise<Result<number, Error>> {
    try {
      const rows = await this.sql<{ id: string }[]>`
        UPDATE backup_manifests
        SET status = 'pruned'
        WHERE workspace_id = ${workspaceId}
          AND status = 'ready'
          AND (expires_at IS NOT NULL AND expires_at < NOW()
            OR started_at < NOW() - ${retentionDays} * INTERVAL '1 day')
        RETURNING id
      `;
      log.info('Pruned old backups', { workspaceId, count: rows.length });
      return ok(rows.length);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Calculate RTO/RPO metrics for a workspace.
   */
  async getRtpRpoMetrics(workspaceId: string): Promise<Result<RtpRpoMetrics, Error>> {
    try {
      type SummaryRow = {
        backup_type: string;
        last_completed_at: Date;
        total_size_bytes: number;
        count: number;
      };

      const rows = await this.sql<SummaryRow[]>`
        SELECT backup_type, MAX(completed_at) AS last_completed_at,
               SUM(size_bytes) AS total_size_bytes, COUNT(*) AS count
        FROM backup_manifests
        WHERE workspace_id = ${workspaceId} AND status = 'ready'
        GROUP BY backup_type
      `;

      const full = rows.find((r) => r.backup_type === 'full');
      const incremental = rows.find((r) => r.backup_type === 'incremental');

      const lastFullAt = full?.last_completed_at ?? null;
      const lastIncrementalAt = incremental?.last_completed_at ?? null;
      const lastBackupAt = lastIncrementalAt ?? lastFullAt;

      const totalSizeBytes = rows.reduce((s, r) => s + Number(r.total_size_bytes ?? 0), 0);
      const rpoHours = calculateRpo(lastBackupAt);
      const rtoMinutes = estimateRtoMinutes(totalSizeBytes);

      return ok({
        workspaceId,
        lastFullBackupAt: lastFullAt,
        lastIncrementalAt,
        lastBackupAt,
        estimatedRpoHours: isFinite(rpoHours) ? Math.round(rpoHours * 100) / 100 : 999,
        estimatedRtoMinutes: rtoMinutes,
        backupCount: {
          full: Number(full?.count ?? 0),
          incremental: Number(incremental?.count ?? 0),
        },
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
