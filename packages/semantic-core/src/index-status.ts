import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'index-status' });

type SqlClient = ReturnType<typeof postgres>;

export type IndexCoverageByType = {
  entityType: string;
  entityCount: number;
  totalBytes: number;
  lastIndexedAt: Date;
};

export type IndexStatus = {
  totalEntities: number;
  totalBytes: number;
  lastIndexedAt: Date | null;
  coverageByType: IndexCoverageByType[];
};

type IndexStatusRow = {
  entity_type: string;
  entity_count: string;
  total_bytes: string;
  last_indexed_at: Date;
};

/**
 * Tracks index health and entity coverage per workspace.
 * Uses an upsert pattern — calling recordEntityIndex overwrites the count for that type.
 */
export class IndexStatusService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Record how many entities of a given type were indexed for a workspace.
   * Uses UPSERT to overwrite previous counts for the same (workspace_id, entity_type) pair.
   *
   * @param workspaceId - Tenant workspace
   * @param entityType  - Entity type (e.g. 'contact', 'company', 'deal')
   * @param entityCount - Number of entities indexed
   * @param totalBytes  - Approximate byte size of indexed content
   */
  async recordEntityIndex(
    workspaceId: string,
    entityType: string,
    entityCount: number,
    totalBytes: number,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO index_status (workspace_id, entity_type, entity_count, total_bytes, last_indexed_at)
        VALUES (${workspaceId}, ${entityType}, ${entityCount}, ${totalBytes}, NOW())
        ON CONFLICT (workspace_id, entity_type)
        DO UPDATE SET
          entity_count  = EXCLUDED.entity_count,
          total_bytes   = EXCLUDED.total_bytes,
          last_indexed_at = NOW()
      `;
      log.info('Index status recorded', { workspaceId, entityType, entityCount, totalBytes });
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to record index status', { workspaceId, entityType, error });
      return err(error);
    }
  }

  /**
   * Return aggregated index status for a workspace.
   * Returns null lastIndexedAt if nothing has been indexed yet.
   *
   * @param workspaceId - Tenant workspace
   */
  async getIndexStatus(workspaceId: string): Promise<Result<IndexStatus, Error>> {
    try {
      const rows = await this.sql<IndexStatusRow[]>`
        SELECT entity_type, entity_count, total_bytes, last_indexed_at
        FROM index_status
        WHERE workspace_id = ${workspaceId}
        ORDER BY entity_count DESC
      `;

      const coverageByType: IndexCoverageByType[] = rows.map((row) => ({
        entityType: row.entity_type,
        entityCount: parseInt(row.entity_count, 10),
        totalBytes: parseInt(row.total_bytes, 10),
        lastIndexedAt: row.last_indexed_at,
      }));

      const totalEntities = coverageByType.reduce((sum, r) => sum + r.entityCount, 0);
      const totalBytes = coverageByType.reduce((sum, r) => sum + r.totalBytes, 0);
      const lastIndexedAt = coverageByType.length > 0
        ? new Date(Math.max(...coverageByType.map((r) => r.lastIndexedAt.getTime())))
        : null;

      return ok({ totalEntities, totalBytes, lastIndexedAt, coverageByType });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to get index status', { workspaceId, error });
      return err(error);
    }
  }
}
