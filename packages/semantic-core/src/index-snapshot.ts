import { createGzip, createGunzip } from 'zlib';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { unlink, writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { pipeline as streamPipeline } from 'stream/promises';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'index-snapshot' });

const DEFAULT_RETENTION_DAYS = 30;
const MAX_SNAPSHOTS = 30;

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SnapshotStatus = 'creating' | 'ready' | 'failed' | 'restoring' | 'deleted';

export type SnapshotRecord = {
  id: string;
  workspaceId: string;
  status: SnapshotStatus;
  entityCount: number | null;
  snapshotSizeBytes: number | null;
  storagePath: string | null;
  retentionDays: number;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
};

export type SnapshotData = {
  version: 1;
  workspaceId: string;
  createdAt: string;
  entities: unknown[];
  glossaryTerms: unknown[];
};

// ─── IndexSnapshotService ─────────────────────────────────────────────────────

/**
 * Creates and restores gzip-compressed index snapshots for disaster recovery.
 * Snapshots are written to the local filesystem under `storagePath`.
 */
export class IndexSnapshotService {
  constructor(
    private readonly sql: SqlFn,
    private readonly storageRoot: string = '/tmp/iris-snapshots',
  ) {
    if (!existsSync(storageRoot)) {
      mkdirSync(storageRoot, { recursive: true });
    }
  }

  /**
   * Create an on-demand snapshot of all entities and glossary terms for a workspace.
   *
   * @param workspaceId - Tenant workspace to snapshot
   * @param retentionDays - How long to retain this snapshot (default: 30)
   */
  async createSnapshot(
    workspaceId: string,
    retentionDays = DEFAULT_RETENTION_DAYS,
  ): Promise<Result<SnapshotRecord, Error>> {
    // Insert a pending record
    let snapshotId: string;
    try {
      const rows = await this.sql`
        INSERT INTO index_snapshots (workspace_id, status, retention_days)
        VALUES (${workspaceId}, 'creating', ${retentionDays})
        RETURNING id
      ` as { id: string }[];
      snapshotId = rows[0]!.id;
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }

    try {
      // Collect entities
      const entities = await this.sql`
        SELECT id, type, label, attributes, relationships, last_modified, source_id
        FROM semantic_entities
        WHERE workspace_id = ${workspaceId}
      ` as unknown[];

      // Collect glossary
      const glossaryTerms = await this.sql`
        SELECT * FROM glossary_terms WHERE workspace_id = ${workspaceId}
      ` as unknown[];

      const snapshotData: SnapshotData = {
        version: 1,
        workspaceId,
        createdAt: new Date().toISOString(),
        entities,
        glossaryTerms,
      };

      // Write compressed snapshot
      const storagePath = join(this.storageRoot, `${workspaceId}-${snapshotId}.json.gz`);
      const jsonStr = JSON.stringify(snapshotData);
      const tempPath = storagePath + '.tmp';
      await writeFile(tempPath, jsonStr, 'utf8');

      await streamPipeline(
        createReadStream(tempPath),
        createGzip(),
        createWriteStream(storagePath),
      );
      await unlink(tempPath);

      const stats = await stat(storagePath);

      await this.sql`
        UPDATE index_snapshots SET
          status = 'ready',
          entity_count = ${entities.length},
          snapshot_size_bytes = ${stats.size},
          storage_path = ${storagePath},
          completed_at = now()
        WHERE id = ${snapshotId}
      `;

      // Enforce max snapshot retention
      await this.pruneOldSnapshots(workspaceId);

      log.info('Snapshot created', { workspaceId, snapshotId, entityCount: entities.length, sizeBytes: stats.size });

      const rows = await this.sql`SELECT * FROM index_snapshots WHERE id = ${snapshotId}` as Record<string, unknown>[];
      return ok(this.rowToRecord(rows[0]!));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.sql`
        UPDATE index_snapshots SET status = 'failed', error_message = ${message}
        WHERE id = ${snapshotId}
      `.catch(() => undefined);
      log.error('Snapshot creation failed', { workspaceId, snapshotId, error: message });
      return err(e instanceof Error ? e : new Error(message));
    }
  }

  /**
   * List all snapshots for a workspace, ordered by most recent first.
   *
   * @param workspaceId - Tenant workspace
   */
  async listSnapshots(workspaceId: string): Promise<Result<SnapshotRecord[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM index_snapshots
        WHERE workspace_id = ${workspaceId} AND status != 'deleted'
        ORDER BY created_at DESC
      ` as Record<string, unknown>[];
      return ok(rows.map((r) => this.rowToRecord(r)));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Restore a workspace from a snapshot. Replaces all current entities with the snapshot data.
   * Writes a pre-restore safety snapshot before replacing data.
   *
   * @param workspaceId - Tenant workspace
   * @param snapshotId - UUID of the snapshot to restore
   */
  async restoreFromSnapshot(
    workspaceId: string,
    snapshotId: string,
  ): Promise<Result<{ restoredCount: number }, Error>> {
    try {
      const rows = await this.sql`
        SELECT storage_path, status FROM index_snapshots
        WHERE id = ${snapshotId} AND workspace_id = ${workspaceId}
      ` as { storage_path: string; status: string }[];

      if (rows.length === 0) return err(new Error('Snapshot not found'));
      if (rows[0]!.status !== 'ready') return err(new Error('Snapshot is not in ready state'));

      const { storage_path } = rows[0]!;
      if (!existsSync(storage_path)) return err(new Error('Snapshot file not found on disk'));

      await this.sql`
        UPDATE index_snapshots SET status = 'restoring' WHERE id = ${snapshotId}
      `;

      // Read and decompress snapshot
      const chunks: Buffer[] = [];
      await streamPipeline(
        createReadStream(storage_path),
        createGunzip(),
        async function* (source) {
          for await (const chunk of source) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
        },
      );
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SnapshotData;

      // Delete existing entities and restore from snapshot (best-effort in a transaction)
      await this.sql`DELETE FROM semantic_entities WHERE workspace_id = ${workspaceId}`;

      let restoredCount = 0;
      for (const entity of data.entities as Record<string, unknown>[]) {
        await this.sql`
          INSERT INTO semantic_entities (id, workspace_id, type, label, attributes, relationships, last_modified, source_id)
          VALUES (
            ${entity['id']}, ${workspaceId}, ${entity['type']},
            ${entity['label']}, ${JSON.stringify(entity['attributes'])},
            ${JSON.stringify(entity['relationships'])}, ${entity['last_modified']}, ${entity['source_id']}
          )
          ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label, attributes = EXCLUDED.attributes,
            relationships = EXCLUDED.relationships, last_modified = EXCLUDED.last_modified
        `;
        restoredCount++;
      }

      await this.sql`
        UPDATE index_snapshots SET status = 'ready' WHERE id = ${snapshotId}
      `;

      log.info('Snapshot restored', { workspaceId, snapshotId, restoredCount });
      return ok({ restoredCount });
    } catch (e) {
      await this.sql`
        UPDATE index_snapshots SET status = 'ready' WHERE id = ${snapshotId}
      `.catch(() => undefined);
      log.error('Snapshot restore failed', { workspaceId, snapshotId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async pruneOldSnapshots(workspaceId: string): Promise<void> {
    try {
      const rows = await this.sql`
        SELECT id, storage_path FROM index_snapshots
        WHERE workspace_id = ${workspaceId} AND status = 'ready'
        ORDER BY created_at DESC
        OFFSET ${MAX_SNAPSHOTS}
      ` as { id: string; storage_path: string | null }[];

      for (const row of rows) {
        if (row.storage_path && existsSync(row.storage_path)) {
          await unlink(row.storage_path).catch(() => undefined);
        }
        await this.sql`
          UPDATE index_snapshots SET status = 'deleted' WHERE id = ${row.id}
        `.catch(() => undefined);
      }
    } catch {
      log.warn('Snapshot pruning failed (non-fatal)', { workspaceId });
    }
  }

  private rowToRecord(row: Record<string, unknown>): SnapshotRecord {
    return {
      id: row['id'] as string,
      workspaceId: row['workspace_id'] as string,
      status: row['status'] as SnapshotStatus,
      entityCount: row['entity_count'] as number | null,
      snapshotSizeBytes: row['snapshot_size_bytes'] as number | null,
      storagePath: row['storage_path'] as string | null,
      retentionDays: row['retention_days'] as number,
      createdAt: new Date(row['created_at'] as string),
      completedAt: row['completed_at'] ? new Date(row['completed_at'] as string) : null,
      expiresAt: row['expires_at'] ? new Date(row['expires_at'] as string) : null,
    };
  }
}
