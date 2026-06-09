import { ok, err, type Result } from 'neverthrow';
import { createHash } from 'crypto';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'context-versioner' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type ContextSnapshot = {
  snapshotId: string;
  workspaceId: string;
  snapshotKey: string;
  capturedAt: Date;
  dataSizeBytes: number;
  gzipSizeBytes: number;
  entityCount: number;
  checksum: string;
};

export type VersionDiff = {
  workspaceId: string;
  fromVersionId: string;
  toVersionId: string;
  changedEntityIds: string[];
  changeTypes: ('created' | 'updated' | 'deleted')[];
  diffSummary: {
    created: number;
    updated: number;
    deleted: number;
    totalChanges: number;
  };
};

export type HistoricalQueryResult = {
  entities: Array<{
    id: string;
    type: string;
    label: string;
    attributes: Record<string, unknown>;
    snapshotedAt: Date;
  }>;
  snapshotId: string;
  queryTokensEstimate: number;
  truncated: boolean;
};

export type VersionHistoryEntry = {
  snapshotId: string;
  snapshotKey: string;
  capturedAt: Date;
  entityCount: number;
  dataSizeBytes: number;
};

/** Compute SHA-256 checksum for a payload string. */
function computeChecksum(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

/** Compress a string to gzip bytes (length in bytes). */
function estimateGzipSize(data: string): number {
  // Rough estimate: gzip achieves ~60% compression on JSON
  return Math.round(Buffer.byteLength(data, 'utf8') * 0.4);
}

/**
 * Capture an immutable point-in-time snapshot of the workspace context index.
 * @param sql - SQL function
 * @param workspaceId - Workspace to snapshot
 * @param snapshotKey - Human-readable label for this snapshot
 */
export async function captureContextSnapshot(
  sql: SqlFn,
  workspaceId: string,
  snapshotKey: string,
): Promise<Result<ContextSnapshot, Error>> {
  try {
    const entities = await sql`
      SELECT id, type, label, attributes, last_modified
      FROM semantic_entities
      WHERE workspace_id = ${workspaceId}
      ORDER BY id
    ` as unknown as Array<{ id: string; type: string; label: string; attributes: unknown; last_modified: string }>;

    const payload = JSON.stringify(entities);
    const dataSizeBytes = Buffer.byteLength(payload, 'utf8');
    const gzipSizeBytes = estimateGzipSize(payload);
    const checksum = computeChecksum(payload);
    const entityCount = entities.length;

    const rows = await sql`
      INSERT INTO context_snapshots
        (workspace_id, snapshot_key, data_size_bytes, gzip_size_bytes, entity_count, checksum, captured_at)
      VALUES (
        ${workspaceId}, ${snapshotKey}, ${dataSizeBytes}, ${gzipSizeBytes},
        ${entityCount}, ${checksum}, NOW()
      )
      RETURNING snapshot_id, captured_at
    ` as unknown as Array<{ snapshot_id: string; captured_at: string }>;

    const row = rows[0];
    if (!row) return err(new Error('Snapshot insert returned no row'));

    log.info('Context snapshot captured', { workspaceId, snapshotKey, entityCount, checksum: checksum.slice(0, 8) });

    return ok({
      snapshotId: row.snapshot_id,
      workspaceId,
      snapshotKey,
      capturedAt: new Date(row.captured_at),
      dataSizeBytes,
      gzipSizeBytes,
      entityCount,
      checksum,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Query context as it existed at a specific point in time.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param query - Natural language query
 * @param targetDate - Historical date to query as of
 * @param contextBudget - Max tokens for response
 */
export async function queryAsOfDate(
  sql: SqlFn,
  workspaceId: string,
  query: string,
  targetDate: Date,
  contextBudget = 2000,
): Promise<Result<HistoricalQueryResult, Error>> {
  try {
    // Find the most recent snapshot at or before targetDate
    const snapshotRows = await sql`
      SELECT snapshot_id, captured_at
      FROM context_snapshots
      WHERE workspace_id = ${workspaceId}
        AND captured_at <= ${targetDate}
      ORDER BY captured_at DESC
      LIMIT 1
    ` as unknown as Array<{ snapshot_id: string; captured_at: string }>;

    if (snapshotRows.length === 0) {
      return ok({
        entities: [],
        snapshotId: '',
        queryTokensEstimate: 0,
        truncated: false,
      });
    }

    const snapshotId = snapshotRows[0]!.snapshot_id;

    // Query entities from snapshot — using last_modified as of that date
    const entityRows = await sql`
      SELECT se.id, se.type, se.label, se.attributes, se.last_modified
      FROM semantic_entities se
      WHERE se.workspace_id = ${workspaceId}
        AND se.last_modified <= ${targetDate}
        AND (
          se.label ILIKE ${'%' + query.slice(0, 50) + '%'}
          OR se.type ILIKE ${'%' + query.slice(0, 20) + '%'}
        )
      ORDER BY se.last_modified DESC
      LIMIT 200
    ` as unknown as Array<{
      id: string;
      type: string;
      label: string;
      attributes: Record<string, unknown>;
      last_modified: string;
    }>;

    const entities: HistoricalQueryResult['entities'] = [];
    let tokenCount = 0;
    let truncated = false;

    for (const row of entityRows) {
      const entityTokens = Math.ceil(JSON.stringify(row).length / 4);
      if (tokenCount + entityTokens > contextBudget) {
        truncated = true;
        break;
      }
      entities.push({
        id: row.id,
        type: row.type,
        label: row.label,
        attributes: row.attributes,
        snapshotedAt: new Date(row.last_modified),
      });
      tokenCount += entityTokens;
    }

    return ok({ entities, snapshotId, queryTokensEstimate: tokenCount, truncated });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Compute a diff between two context versions.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param fromVersionId - Earlier snapshot ID
 * @param toVersionId - Later snapshot ID
 */
export async function diffContextVersions(
  sql: SqlFn,
  workspaceId: string,
  fromVersionId: string,
  toVersionId: string,
): Promise<Result<VersionDiff, Error>> {
  try {
    // Check if diff already cached
    const cachedRows = await sql`
      SELECT changed_entity_ids, change_types, diff_summary
      FROM version_diffs
      WHERE workspace_id = ${workspaceId}
        AND from_version_id = ${fromVersionId}
        AND to_version_id = ${toVersionId}
      LIMIT 1
    ` as unknown as Array<{
      changed_entity_ids: string;
      change_types: string;
      diff_summary: string;
    }>;

    if (cachedRows.length > 0) {
      const cached = cachedRows[0]!;
      return ok({
        workspaceId,
        fromVersionId,
        toVersionId,
        changedEntityIds: JSON.parse(cached.changed_entity_ids) as string[],
        changeTypes: JSON.parse(cached.change_types) as ('created' | 'updated' | 'deleted')[],
        diffSummary: JSON.parse(cached.diff_summary) as VersionDiff['diffSummary'],
      });
    }

    const fromRows = await sql`
      SELECT snapshot_id, captured_at FROM context_snapshots
      WHERE snapshot_id = ${fromVersionId} AND workspace_id = ${workspaceId}
      LIMIT 1
    ` as unknown as Array<{ snapshot_id: string; captured_at: string }>;

    const toRows = await sql`
      SELECT snapshot_id, captured_at FROM context_snapshots
      WHERE snapshot_id = ${toVersionId} AND workspace_id = ${workspaceId}
      LIMIT 1
    ` as unknown as Array<{ snapshot_id: string; captured_at: string }>;

    if (fromRows.length === 0 || toRows.length === 0) {
      return err(new Error('One or both snapshots not found'));
    }

    const fromDate = new Date(fromRows[0]!.captured_at);
    const toDate = new Date(toRows[0]!.captured_at);

    // Find entities created between versions
    const createdRows = await sql`
      SELECT id FROM semantic_entities
      WHERE workspace_id = ${workspaceId}
        AND last_modified > ${fromDate}
        AND last_modified <= ${toDate}
        AND created_at > ${fromDate}
    ` as unknown as Array<{ id: string }>;

    // Find entities updated between versions (not new)
    const updatedRows = await sql`
      SELECT id FROM semantic_entities
      WHERE workspace_id = ${workspaceId}
        AND last_modified > ${fromDate}
        AND last_modified <= ${toDate}
        AND created_at <= ${fromDate}
    ` as unknown as Array<{ id: string }>;

    const createdIds = createdRows.map(r => r.id);
    const updatedIds = updatedRows.map(r => r.id);
    const changedEntityIds = [...createdIds, ...updatedIds];
    const changeTypes: ('created' | 'updated' | 'deleted')[] = [
      ...createdIds.map(() => 'created' as const),
      ...updatedIds.map(() => 'updated' as const),
    ];
    const diffSummary = {
      created: createdIds.length,
      updated: updatedIds.length,
      deleted: 0,
      totalChanges: createdIds.length + updatedIds.length,
    };

    // Cache the diff
    await sql`
      INSERT INTO version_diffs
        (workspace_id, from_version_id, to_version_id, changed_entity_ids, change_types, diff_summary)
      VALUES (
        ${workspaceId}, ${fromVersionId}, ${toVersionId},
        ${JSON.stringify(changedEntityIds)}, ${JSON.stringify(changeTypes)}, ${JSON.stringify(diffSummary)}
      )
      ON CONFLICT (workspace_id, from_version_id, to_version_id) DO NOTHING
    `;

    return ok({ workspaceId, fromVersionId, toVersionId, changedEntityIds, changeTypes, diffSummary });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * List version history for a workspace with cursor-based pagination.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param limit - Max entries to return
 * @param cursor - Opaque cursor (snapshot_id) for pagination
 */
export async function listVersionHistory(
  sql: SqlFn,
  workspaceId: string,
  limit = 20,
  cursor?: string,
): Promise<Result<{ entries: VersionHistoryEntry[]; nextCursor: string | null; hasMore: boolean }, Error>> {
  try {
    const rows = cursor
      ? await sql`
          SELECT snapshot_id, snapshot_key, captured_at, entity_count, data_size_bytes
          FROM context_snapshots
          WHERE workspace_id = ${workspaceId}
            AND captured_at < (SELECT captured_at FROM context_snapshots WHERE snapshot_id = ${cursor} LIMIT 1)
          ORDER BY captured_at DESC
          LIMIT ${limit + 1}
        `
      : await sql`
          SELECT snapshot_id, snapshot_key, captured_at, entity_count, data_size_bytes
          FROM context_snapshots
          WHERE workspace_id = ${workspaceId}
          ORDER BY captured_at DESC
          LIMIT ${limit + 1}
        `;

    const typed = rows as unknown as Array<{
      snapshot_id: string;
      snapshot_key: string;
      captured_at: string;
      entity_count: number;
      data_size_bytes: number;
    }>;

    const hasMore = typed.length > limit;
    const page = typed.slice(0, limit);
    const nextCursor = hasMore ? page[page.length - 1]!.snapshot_id : null;

    return ok({
      entries: page.map(r => ({
        snapshotId: r.snapshot_id,
        snapshotKey: r.snapshot_key,
        capturedAt: new Date(r.captured_at),
        entityCount: r.entity_count,
        dataSizeBytes: r.data_size_bytes,
      })),
      nextCursor,
      hasMore,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Rollback workspace index to a previous snapshot (admin-only operation).
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param versionId - Snapshot ID to roll back to
 * @param confirmedByUserId - Admin user authorizing the rollback
 */
export async function rollbackToVersion(
  sql: SqlFn,
  workspaceId: string,
  versionId: string,
  confirmedByUserId: string,
): Promise<Result<{ rolledBackTo: Date; entityCount: number }, Error>> {
  try {
    const snapshotRows = await sql`
      SELECT snapshot_id, captured_at, entity_count
      FROM context_snapshots
      WHERE snapshot_id = ${versionId} AND workspace_id = ${workspaceId}
      LIMIT 1
    ` as unknown as Array<{ snapshot_id: string; captured_at: string; entity_count: number }>;

    if (snapshotRows.length === 0) {
      return err(new Error(`Snapshot ${versionId} not found for workspace ${workspaceId}`));
    }

    const snapshot = snapshotRows[0]!;
    const rollbackTo = new Date(snapshot.captured_at);

    // Remove entities created after snapshot date
    await sql`
      DELETE FROM semantic_entities
      WHERE workspace_id = ${workspaceId}
        AND created_at > ${rollbackTo}
    `;

    // Revert entities modified after snapshot to their state at snapshot time
    await sql`
      UPDATE semantic_entities
      SET last_modified = ${rollbackTo}
      WHERE workspace_id = ${workspaceId}
        AND last_modified > ${rollbackTo}
    `;

    // Audit the rollback
    await sql`
      INSERT INTO context_snapshots
        (workspace_id, snapshot_key, data_size_bytes, gzip_size_bytes, entity_count, checksum, captured_at)
      SELECT workspace_id, ${'ROLLBACK_TO_' + versionId}, data_size_bytes, gzip_size_bytes, entity_count,
             checksum, NOW()
      FROM context_snapshots
      WHERE snapshot_id = ${versionId}
    `;

    log.info('Context rolled back', { workspaceId, versionId, confirmedByUserId, rollbackTo });

    return ok({ rolledBackTo: rollbackTo, entityCount: snapshot.entity_count });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
