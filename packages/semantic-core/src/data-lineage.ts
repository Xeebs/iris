import type postgres from 'postgres';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ service: 'data-lineage' });

export type LineageTransformationType =
  | 'embedding'
  | 'deduplication'
  | 'relationship'
  | 'pii_masking'
  | 'enrichment';

export type DependencyRelationshipType = 'references' | 'contains' | 'derived_from' | 'shares_owner';

export interface EntityDependency {
  entityId: string;
  dependsOnEntityId: string;
  relationshipType: DependencyRelationshipType;
  workspaceId: string;
  confidence: number;
}

export interface ImpactAnalysisResult {
  entityId: string;
  affectedEntityIds: string[];
  depth: number;
  affectedCount: number;
}

export interface LineageGraph {
  entityId: string;
  ancestors: Array<{ entityId: string; depth: number; relationshipType: string }>;
  descendants: Array<{ entityId: string; depth: number; relationshipType: string }>;
}

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
        ${this.sql.json({ transformations: [transformation] } as unknown as Parameters<typeof this.sql.json>[0])},
        now()
      )
      ON CONFLICT (entity_id, workspace_id) DO UPDATE SET
        lineage_json = jsonb_set(
          entity_lineage.lineage_json,
          '{transformations}',
          (entity_lineage.lineage_json->'transformations') || ${this.sql.json([transformation] as unknown as Parameters<typeof this.sql.json>[0])}
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
      last_modified_at: new Date(),
    }));

    // postgres.js multi-row insert helper — the previous SELECT ... FROM
    // ${sql(rows)} form is not a supported helper position and crashed
    // inside the driver's identifier escaping.
    await this.sql`
      INSERT INTO entity_lineage ${this.sql(rows)}
      ON CONFLICT (entity_id, workspace_id) DO UPDATE SET
        source_connector_id  = EXCLUDED.source_connector_id,
        source_sync_job_id   = EXCLUDED.source_sync_job_id,
        source_api_timestamp = EXCLUDED.source_api_timestamp,
        last_modified_by     = EXCLUDED.last_modified_by,
        last_modified_at     = now()
    `;

    log.info('Bulk-recorded entity origins', { count: entries.length });
  }

  /**
   * Record a dependency edge: entityId depends on dependsOnEntityId.
   * Upserts — safe to call repeatedly with the same pair.
   *
   * @param entityId           - The dependent entity
   * @param dependsOnEntityId  - The entity it depends on
   * @param workspaceId        - Workspace to scope the record
   * @param relationshipType   - Nature of the dependency
   * @param confidence         - Confidence score [0, 1]
   */
  async recordDependency(
    entityId: string,
    dependsOnEntityId: string,
    workspaceId: string,
    relationshipType: DependencyRelationshipType = 'references',
    confidence = 1.0,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO entity_dependencies
          (entity_id, depends_on_entity_id, workspace_id, relationship_type, confidence)
        VALUES (
          ${entityId}, ${dependsOnEntityId}, ${workspaceId},
          ${relationshipType}, ${confidence}
        )
        ON CONFLICT (entity_id, depends_on_entity_id, workspace_id) DO UPDATE SET
          relationship_type = EXCLUDED.relationship_type,
          confidence        = EXCLUDED.confidence
      `;
      log.debug('Recorded entity dependency', { entityId, dependsOnEntityId, workspaceId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compute which entities are transitively affected when entityId changes.
   * Performs BFS up to maxDepth hops following reverse dependency edges
   * (i.e. entities that depend on entityId).
   *
   * @param entityId    - Entity that changed
   * @param workspaceId - Workspace scope
   * @param maxDepth    - Maximum traversal depth (default: 3)
   */
  async computeImpact(
    entityId: string,
    workspaceId: string,
    maxDepth = 3,
  ): Promise<Result<ImpactAnalysisResult, Error>> {
    try {
      const visited = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: entityId, depth: 0 }];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= maxDepth) continue;

        const rows = await this.sql<Array<{ entity_id: string }>>`
          SELECT entity_id
          FROM entity_dependencies
          WHERE depends_on_entity_id = ${current.id}
            AND workspace_id = ${workspaceId}
        `;

        for (const row of rows) {
          if (!visited.has(row.entity_id) && row.entity_id !== entityId) {
            visited.add(row.entity_id);
            queue.push({ id: row.entity_id, depth: current.depth + 1 });
          }
        }
      }

      const affectedEntityIds = [...visited];
      log.info('Impact analysis complete', {
        entityId,
        workspaceId,
        affectedCount: affectedEntityIds.length,
        maxDepth,
      });

      return ok({ entityId, affectedEntityIds, depth: maxDepth, affectedCount: affectedEntityIds.length });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Build a lineage graph showing ancestors (what this entity was derived from)
   * and descendants (what depends on this entity) up to maxDepth hops each way.
   *
   * @param entityId    - Root entity
   * @param workspaceId - Workspace scope
   * @param maxDepth    - Maximum traversal depth each direction (default: 3)
   */
  async getLineageGraph(
    entityId: string,
    workspaceId: string,
    maxDepth = 3,
  ): Promise<Result<LineageGraph, Error>> {
    try {
      const ancestors = await this.traverseDirection(entityId, workspaceId, 'up', maxDepth);
      const descendants = await this.traverseDirection(entityId, workspaceId, 'down', maxDepth);
      return ok({ entityId, ancestors, descendants });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async traverseDirection(
    startId: string,
    workspaceId: string,
    direction: 'up' | 'down',
    maxDepth: number,
  ): Promise<Array<{ entityId: string; depth: number; relationshipType: string }>> {
    const visited: Array<{ entityId: string; depth: number; relationshipType: string }> = [];
    const seen = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const rows = direction === 'up'
        ? await this.sql<Array<{ depends_on_entity_id: string; relationship_type: string }>>`
            SELECT depends_on_entity_id, relationship_type
            FROM entity_dependencies
            WHERE entity_id = ${current.id}
              AND workspace_id = ${workspaceId}
          `
        : await this.sql<Array<{ entity_id: string; relationship_type: string }>>`
            SELECT entity_id, relationship_type
            FROM entity_dependencies
            WHERE depends_on_entity_id = ${current.id}
              AND workspace_id = ${workspaceId}
          `;

      for (const row of rows) {
        const nextId = direction === 'up'
          ? (row as { depends_on_entity_id: string }).depends_on_entity_id
          : (row as { entity_id: string }).entity_id;

        if (!seen.has(nextId) && nextId !== startId) {
          seen.add(nextId);
          const depth = current.depth + 1;
          visited.push({ entityId: nextId, depth, relationshipType: row.relationship_type });
          queue.push({ id: nextId, depth });
        }
      }
    }

    return visited;
  }
}
