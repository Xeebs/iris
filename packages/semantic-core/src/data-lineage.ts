import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ service: 'data-lineage' });

export type LineageTransformationType =
  | 'embedding'
  | 'deduplication'
  | 'relationship'
  | 'pii_masking'
  | 'enrichment';

export interface LineageTransformation {
  type: LineageTransformationType;
  timestamp: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

export interface LineageOrigin {
  connectorId: string;
  syncJobId?: string;
  sourceApiTimestamp?: Date;
  rawSourceId?: string;
  modifiedBy?: string;
}

export interface LineageRecord {
  entityId: string;
  workspaceId: string;
  sourceConnectorId: string;
  sourceSyncJobId?: string;
  sourceApiTimestamp?: Date;
  transformations: LineageTransformation[];
  lastModifiedBy: string;
  lastModifiedAt: Date;
}

type LineageRow = {
  entity_id: string;
  workspace_id: string;
  source_connector_id: string;
  source_sync_job_id: string | null;
  source_api_timestamp: Date | null;
  lineage_json: { transformations: LineageTransformation[] };
  last_modified_by: string;
  last_modified_at: Date;
};

function rowToRecord(row: LineageRow): LineageRecord {
  return {
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    sourceConnectorId: row.source_connector_id,
    ...(row.source_sync_job_id !== null ? { sourceSyncJobId: row.source_sync_job_id } : {}),
    ...(row.source_api_timestamp !== null ? { sourceApiTimestamp: row.source_api_timestamp } : {}),
    transformations: row.lineage_json.transformations ?? [],
    lastModifiedBy: row.last_modified_by,
    lastModifiedAt: row.last_modified_at,
  };
}

/**
 * Records data provenance for semantic entities — where they came from and how they were transformed.
 * Keeps one lineage record per entity, accumulating transformations incrementally.
 */
export class DataLineageService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Create or update the origin record for an entity.
   * Safe to call multiple times; updates source fields and last_modified_at on conflict.
   *
   * @param entityId  - Globally unique entity ID
   * @param workspaceId - Workspace the entity belongs to
   * @param origin    - Source metadata for this entity
   */
  async recordOrigin(entityId: string, workspaceId: string, origin: LineageOrigin): Promise<void> {
    await this.sql`
      INSERT INTO entity_lineage
        (entity_id, workspace_id, source_connector_id, source_sync_job_id,
         source_api_timestamp, last_modified_by, last_modified_at)
      VALUES (
        ${entityId},
        ${workspaceId},
        ${origin.connectorId},
        ${origin.syncJobId ?? null},
        ${origin.sourceApiTimestamp ?? null},
        ${origin.modifiedBy ?? 'system'},
        now()
      )
      ON CONFLICT (entity_id, workspace_id) DO UPDATE SET
        source_connector_id  = EXCLUDED.source_connector_id,
        source_sync_job_id   = EXCLUDED.source_sync_job_id,
        source_api_timestamp = EXCLUDED.source_api_timestamp,
        last_modified_by     = EXCLUDED.last_modified_by,
        last_modified_at     = now()
    `;

    log.debug('Recorded entity origin', { entityId, workspaceId, connectorId: origin.connectorId });
  }

  /**
   * Append a transformation step to an entity's lineage record.
   * Inserts a stub record first if the entity has no lineage yet.
   *
   * @param entityId        - Globally unique entity ID
   * @param workspaceId     - Workspace the entity belongs to
   * @param transformation  - Transformation step to append
   */
  async addTransformation(
    entityId: string,
    workspaceId: string,
    transformation: LineageTransformation,
  ): Promise<void> {
    await this.sql`
      INSERT INTO entity_lineage
        (entity_id, workspace_id, source_connector_id, lineage_json, last_modified_at)
      VALUES (
        ${entityId},
        ${workspaceId},
        'unknown',
        ${JSON.stringify({ transformations: [transformation] })},
        now()
      )
      ON CONFLICT (entity_id, workspace_id) DO UPDATE SET
        lineage_json = jsonb_set(
          entity_lineage.lineage_json,
          '{transformations}',
          (entity_lineage.lineage_json->'transformations') || ${JSON.stringify([transformation])}::jsonb
        ),
        last_modified_at = now()
    `;

    log.debug('Appended lineage transformation', {
      entityId,
      workspaceId,
      transformationType: transformation.type,
    });
  }

  /**
   * Retrieve the full lineage record for an entity.
   * Returns null when no lineage has been recorded.
   *
   * @param entityId    - Globally unique entity ID
   * @param workspaceId - Workspace to scope the lookup
   */
  async getLineage(entityId: string, workspaceId: string): Promise<LineageRecord | null> {
    const rows = await this.sql<LineageRow[]>`
      SELECT
        entity_id, workspace_id, source_connector_id, source_sync_job_id,
        source_api_timestamp, lineage_json, last_modified_by, last_modified_at
      FROM entity_lineage
      WHERE entity_id = ${entityId} AND workspace_id = ${workspaceId}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;

    return rowToRecord(row);
  }

  /**
   * List lineage records for a workspace, ordered by most recently modified.
   * Cursor is the ISO timestamp of the last record on the previous page.
   *
   * @param workspaceId - Workspace to list records for
   * @param limit       - Maximum records to return
   * @param cursor      - ISO timestamp cursor for pagination
   */
  async listEntityLineage(
    workspaceId: string,
    limit = 50,
    cursor?: string,
  ): Promise<LineageRecord[]> {
    const rows = await this.sql<LineageRow[]>`
      SELECT
        entity_id, workspace_id, source_connector_id, source_sync_job_id,
        source_api_timestamp, lineage_json, last_modified_by, last_modified_at
      FROM entity_lineage
      WHERE workspace_id = ${workspaceId}
        ${cursor ? this.sql`AND last_modified_at < ${cursor}::timestamptz` : this.sql``}
      ORDER BY last_modified_at DESC
      LIMIT ${limit}
    `;

    return rows.map(rowToRecord);
  }

  /**
   * Bulk-record origins for a batch of entities.
   * More efficient than calling recordOrigin() in a loop.
   *
   * @param entries - Array of {entityId, workspaceId, origin} tuples
   */
  async recordOriginBatch(
    entries: Array<{ entityId: string; workspaceId: string; origin: LineageOrigin }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const rows = entries.map(({ entityId, workspaceId, origin }) => ({
      entity_id: entityId,
      workspace_id: workspaceId,
      source_connector_id: origin.connectorId,
      source_sync_job_id: origin.syncJobId ?? null,
      source_api_timestamp: origin.sourceApiTimestamp ?? null,
      last_modified_by: origin.modifiedBy ?? 'system',
    }));

    await this.sql`
      INSERT INTO entity_lineage
        (entity_id, workspace_id, source_connector_id, source_sync_job_id,
         source_api_timestamp, last_modified_by, last_modified_at)
      SELECT entity_id, workspace_id, source_connector_id, source_sync_job_id,
             source_api_timestamp, last_modified_by, now()
      FROM ${this.sql(rows)}
      ON CONFLICT (entity_id, workspace_id) DO UPDATE SET
        source_connector_id  = EXCLUDED.source_connector_id,
        source_sync_job_id   = EXCLUDED.source_sync_job_id,
        source_api_timestamp = EXCLUDED.source_api_timestamp,
        last_modified_by     = EXCLUDED.last_modified_by,
        last_modified_at     = now()
    `;

    log.info('Bulk-recorded entity origins', { count: entries.length });
  }
}
