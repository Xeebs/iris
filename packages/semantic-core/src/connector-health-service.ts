import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'connector-health' });

type SqlClient = ReturnType<typeof postgres>;

export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type ConnectorHealthRecord = {
  id: string;
  instanceId: string;
  workspaceId: string;
  status: ConnectorHealthStatus;
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: Date;
};

export type ConnectorHealthSummary = {
  instanceId: string;
  workspaceId: string;
  status: ConnectorHealthStatus;
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: Date;
};

type HealthRow = {
  id: string;
  instance_id: string;
  workspace_id: string;
  status: string;
  latency_ms: number | null;
  error_message: string | null;
  checked_at: Date;
};

/**
 * Stores and retrieves connector health check results.
 * Designed to be called after each sync or on a periodic health check schedule.
 */
export class ConnectorHealthService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Record a health check result for a connector instance.
   *
   * @param instanceId  - Connector instance ID
   * @param workspaceId - Tenant workspace
   * @param status      - Health status: healthy | degraded | unhealthy
   * @param latencyMs   - Round-trip latency of health check in ms
   * @param errorMessage - Error message if unhealthy/degraded
   */
  async recordHealth(
    instanceId: string,
    workspaceId: string,
    status: ConnectorHealthStatus,
    latencyMs?: number,
    errorMessage?: string,
  ): Promise<Result<ConnectorHealthRecord, Error>> {
    try {
      const [row] = await this.sql<HealthRow[]>`
        INSERT INTO connector_health (instance_id, workspace_id, status, latency_ms, error_message)
        VALUES (
          ${instanceId},
          ${workspaceId},
          ${status},
          ${latencyMs ?? null},
          ${errorMessage ?? null}
        )
        RETURNING id, instance_id, workspace_id, status, latency_ms, error_message, checked_at
      `;

      if (!row) {
        return err(new Error('Failed to insert health record'));
      }

      log.info('Health check recorded', { instanceId, workspaceId, status, latencyMs });

      return ok({
        id: row.id,
        instanceId: row.instance_id,
        workspaceId: row.workspace_id,
        status: row.status as ConnectorHealthStatus,
        latencyMs: row.latency_ms,
        errorMessage: row.error_message,
        checkedAt: row.checked_at,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the latest health record for a specific connector instance.
   *
   * @param instanceId  - Connector instance ID
   * @param workspaceId - Tenant workspace (for tenant isolation)
   */
  async getHealth(instanceId: string, workspaceId: string): Promise<Result<ConnectorHealthSummary | null, Error>> {
    try {
      const rows = await this.sql<HealthRow[]>`
        SELECT id, instance_id, workspace_id, status, latency_ms, error_message, checked_at
        FROM connector_health
        WHERE instance_id = ${instanceId}
          AND workspace_id = ${workspaceId}
        ORDER BY checked_at DESC
        LIMIT 1
      `;

      if (rows.length === 0) return ok(null);

      const row = rows[0]!;
      return ok({
        instanceId: row.instance_id,
        workspaceId: row.workspace_id,
        status: row.status as ConnectorHealthStatus,
        latencyMs: row.latency_ms,
        errorMessage: row.error_message,
        checkedAt: row.checked_at,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the latest health status for all connector instances in a workspace.
   *
   * @param workspaceId - Tenant workspace
   */
  async getAllHealth(workspaceId: string): Promise<Result<ConnectorHealthSummary[], Error>> {
    try {
      const rows = await this.sql<HealthRow[]>`
        SELECT DISTINCT ON (instance_id)
          id, instance_id, workspace_id, status, latency_ms, error_message, checked_at
        FROM connector_health
        WHERE workspace_id = ${workspaceId}
        ORDER BY instance_id, checked_at DESC
      `;

      return ok(rows.map((row) => ({
        instanceId: row.instance_id,
        workspaceId: row.workspace_id,
        status: row.status as ConnectorHealthStatus,
        latencyMs: row.latency_ms,
        errorMessage: row.error_message,
        checkedAt: row.checked_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
