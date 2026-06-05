import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'metrics' });

export interface Metric {
  id: string;
  workspaceId: string;
  name: string;
  formula: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const metricRow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  formula: z.string(),
  description: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

type SqlClient = ReturnType<typeof postgres>;

function toMetric(row: z.infer<typeof metricRow>): Metric {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    formula: row.formula,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MetricRegistry {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Define or update a metric for a workspace.
   * @param workspaceId - Workspace identifier
   * @param name - Metric name (unique per workspace)
   * @param formula - Calculation formula or expression
   * @param description - Human-readable description
   * @returns Result with the created/updated metric
   */
  async defineMetric(
    workspaceId: string,
    name: string,
    formula: string,
    description: string,
  ): Promise<Result<Metric, Error>> {
    try {
      const [row] = await this.sql<z.infer<typeof metricRow>[]>`
        INSERT INTO metrics (workspace_id, name, formula, description)
        VALUES (${workspaceId}, ${name}, ${formula}, ${description})
        ON CONFLICT (workspace_id, name) DO UPDATE
          SET formula     = EXCLUDED.formula,
              description = EXCLUDED.description,
              updated_at  = NOW()
        RETURNING *
      `;
      if (!row) return err(new Error('No row returned from INSERT'));
      log.info('Metric defined', { workspaceId, name });
      return ok(toMetric(row));
    } catch (e) {
      log.error('Failed to define metric', { workspaceId, name, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve a single metric by name.
   * @param workspaceId - Workspace identifier
   * @param name - Metric name to look up
   * @returns Result with the metric or null if not found
   */
  async getMetric(
    workspaceId: string,
    name: string,
  ): Promise<Result<Metric | null, Error>> {
    try {
      const [row] = await this.sql<z.infer<typeof metricRow>[]>`
        SELECT * FROM metrics
        WHERE workspace_id = ${workspaceId} AND name = ${name}
      `;
      return ok(row ? toMetric(row) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all metrics for a workspace.
   * @param workspaceId - Workspace identifier
   * @returns Result with array of metrics
   */
  async listMetrics(workspaceId: string): Promise<Result<Metric[], Error>> {
    try {
      const rows = await this.sql<z.infer<typeof metricRow>[]>`
        SELECT * FROM metrics
        WHERE workspace_id = ${workspaceId}
        ORDER BY name ASC
      `;
      return ok(rows.map(toMetric));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a metric by name.
   * @param workspaceId - Workspace identifier
   * @param name - Metric name to delete
   * @returns Result with true if deleted, false if not found
   */
  async deleteMetric(
    workspaceId: string,
    name: string,
  ): Promise<Result<boolean, Error>> {
    try {
      const result = await this.sql`
        DELETE FROM metrics
        WHERE workspace_id = ${workspaceId} AND name = ${name}
      `;
      const deleted = result.count > 0;
      if (deleted) log.info('Metric deleted', { workspaceId, name });
      return ok(deleted);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
