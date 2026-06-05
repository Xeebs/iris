import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import type { JSONValue } from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'connector-service' });

export type ConnectorStatus = 'active' | 'error' | 'syncing';

export type ConnectorInstance = {
  id: string;
  workspaceId: string;
  connectorId: string;
  config: Record<string, unknown>;
  status: ConnectorStatus;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SqlClient = ReturnType<typeof postgres>;

type InstanceRow = {
  id: string;
  workspace_id: string;
  connector_id: string;
  config: Record<string, unknown>;
  status: ConnectorStatus;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function rowToInstance(row: InstanceRow): ConnectorInstance {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    connectorId: row.connector_id,
    config: row.config,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConnectorService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * @param workspaceId - Tenant workspace
   * @param connectorId - Connector type (e.g., "hubspot")
   * @param config - Validated connector configuration
   * @returns Created connector instance
   */
  async createInstance(
    workspaceId: string,
    connectorId: string,
    config: Record<string, unknown>,
  ): Promise<Result<ConnectorInstance, Error>> {
    try {
      const [row] = await this.sql<InstanceRow[]>`
        INSERT INTO connector_instances (workspace_id, connector_id, config)
        VALUES (${workspaceId}, ${connectorId}, ${this.sql.json(config as unknown as JSONValue)})
        RETURNING *
      `;
      if (!row) return err(new Error('Insert returned no row'));
      log.info('Connector instance created', { id: row.id, connectorId, workspaceId });
      return ok(rowToInstance(row));
    } catch (e) {
      log.error('Failed to create connector instance', { error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @param id - Instance UUID
   * @returns Instance or null if not found
   */
  async getInstance(
    workspaceId: string,
    id: string,
  ): Promise<Result<ConnectorInstance | null, Error>> {
    try {
      const [row] = await this.sql<InstanceRow[]>`
        SELECT * FROM connector_instances
        WHERE id = ${id} AND workspace_id = ${workspaceId}
      `;
      return ok(row ? rowToInstance(row) : null);
    } catch (e) {
      log.error('Failed to get connector instance', { error: e, id });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @returns All instances for the workspace
   */
  async listInstances(workspaceId: string): Promise<Result<ConnectorInstance[], Error>> {
    try {
      const rows = await this.sql<InstanceRow[]>`
        SELECT * FROM connector_instances
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
      `;
      return ok(rows.map(rowToInstance));
    } catch (e) {
      log.error('Failed to list connector instances', { error: e, workspaceId });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @param id - Instance UUID
   * @param config - Updated connector configuration
   * @returns Updated instance or null if not found
   */
  async updateInstance(
    workspaceId: string,
    id: string,
    config: Record<string, unknown>,
  ): Promise<Result<ConnectorInstance | null, Error>> {
    try {
      const [row] = await this.sql<InstanceRow[]>`
        UPDATE connector_instances
        SET config = ${this.sql.json(config as unknown as JSONValue)}, updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspaceId}
        RETURNING *
      `;
      return ok(row ? rowToInstance(row) : null);
    } catch (e) {
      log.error('Failed to update connector instance', { error: e, id });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @param id - Instance UUID
   * @returns true if deleted, false if not found
   */
  async deleteInstance(workspaceId: string, id: string): Promise<Result<boolean, Error>> {
    try {
      const result = await this.sql`
        DELETE FROM connector_instances
        WHERE id = ${id} AND workspace_id = ${workspaceId}
      `;
      return ok(result.count > 0);
    } catch (e) {
      log.error('Failed to delete connector instance', { error: e, id });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param id - Instance UUID
   * @param status - New status
   * @param lastSyncedAt - Optional sync completion timestamp
   */
  async updateStatus(
    id: string,
    status: ConnectorStatus,
    lastSyncedAt?: Date,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE connector_instances
        SET status = ${status},
            last_synced_at = COALESCE(${lastSyncedAt ?? null}, last_synced_at),
            updated_at = NOW()
        WHERE id = ${id}
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to update connector status', { error: e, id });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
