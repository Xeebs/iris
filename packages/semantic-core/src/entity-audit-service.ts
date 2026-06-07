import type postgres from 'postgres';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'entity-audit-service' });

type SqlFn = ReturnType<typeof postgres>;

export type ChangeType = 'created' | 'updated' | 'deleted';
export type ChangeSource = 'connector_sync' | 'webhook' | 'user_import' | 'manual';

export type AuditEvent = {
  id: string;
  workspaceId: string;
  entityId: string;
  entityType: string;
  changeType: ChangeType;
  changedBy: ChangeSource;
  sourceConnectorId: string | null;
  oldValuesJson: Record<string, unknown> | null;
  newValuesJson: Record<string, unknown> | null;
  changedFields: string[];
  anomalyFlags: string[];
  timestamp: Date;
};

export type TrackChangeOptions = {
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  sourceConnectorId?: string;
};

export type FieldHistory = {
  field: string;
  timeline: Array<{
    timestamp: Date;
    value: unknown;
    changedBy: ChangeSource;
  }>;
};

export type AnomalyReport = {
  entityId: string;
  anomalyType: 'rapid_recreation' | 'oscillating_field' | 'bulk_deletion' | 'frequent_updates';
  severity: 'low' | 'medium' | 'high';
  details: string;
  detectedAt: Date;
};

type AuditEventRow = {
  id: string;
  workspace_id: string;
  entity_id: string;
  entity_type: string;
  change_type: ChangeType;
  changed_by: ChangeSource;
  source_connector_id: string | null;
  old_values_json: Record<string, unknown> | null;
  new_values_json: Record<string, unknown> | null;
  changed_fields: string[];
  anomaly_flags: string[];
  timestamp: Date;
};

function rowToAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    changeType: row.change_type,
    changedBy: row.changed_by,
    sourceConnectorId: row.source_connector_id,
    oldValuesJson: row.old_values_json,
    newValuesJson: row.new_values_json,
    changedFields: row.changed_fields ?? [],
    anomalyFlags: row.anomaly_flags ?? [],
    timestamp: new Date(row.timestamp),
  };
}

function diffFields(
  oldVals: Record<string, unknown> | undefined,
  newVals: Record<string, unknown> | undefined,
): string[] {
  if (!oldVals || !newVals) return [];
  const allKeys = new Set([...Object.keys(oldVals), ...Object.keys(newVals)]);
  return [...allKeys].filter((k) => {
    const oldV = JSON.stringify(oldVals[k]);
    const newV = JSON.stringify(newVals[k]);
    return oldV !== newV;
  });
}

/**
 * Records and queries entity change history for compliance and debugging.
 * Stores before/after values, change source, and detected anomalies.
 */
export class EntityAuditService {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Track a change to an entity, computing diff of changed fields.
   *
   * @param workspaceId - Tenant workspace
   * @param entityId    - Canonical entity ID
   * @param entityType  - Entity type (contact, deal, etc.)
   * @param changeType  - created | updated | deleted
   * @param changedBy   - Source of the change
   * @param options     - Old/new values and connector ID
   * @returns Created audit event
   */
  async trackChange(
    workspaceId: string,
    entityId: string,
    entityType: string,
    changeType: ChangeType,
    changedBy: ChangeSource,
    options: TrackChangeOptions = {},
  ): Promise<Result<AuditEvent, Error>> {
    try {
      const changedFields = changeType === 'updated'
        ? diffFields(options.oldValues, options.newValues)
        : [];

      const rows = await this.sql<AuditEventRow[]>`
        INSERT INTO entity_audit_events (
          workspace_id, entity_id, entity_type, change_type, changed_by,
          source_connector_id, old_values_json, new_values_json, changed_fields
        )
        VALUES (
          ${workspaceId}, ${entityId}, ${entityType}, ${changeType}, ${changedBy},
          ${options.sourceConnectorId ?? null},
          ${options.oldValues ? JSON.stringify(options.oldValues) : null},
          ${options.newValues ? JSON.stringify(options.newValues) : null},
          ${this.sql.array(changedFields)}
        )
        RETURNING *
      `;
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));

      log.info('Entity change tracked', { workspaceId, entityId, changeType, changedBy });
      return ok(rowToAuditEvent(row));
    } catch (e) {
      log.error('Failed to track entity change', { workspaceId, entityId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get change history for an entity within a time range.
   *
   * @param workspaceId - Tenant workspace
   * @param entityId    - Entity to query
   * @param timeRange   - Optional ISO date range { from, to }
   * @param limit       - Max events to return (default 50)
   * @returns Ordered list of audit events (most recent first)
   */
  async getHistory(
    workspaceId: string,
    entityId: string,
    timeRange?: { from?: string; to?: string },
    limit = 50,
  ): Promise<Result<AuditEvent[], Error>> {
    try {
      const from = timeRange?.from ?? null;
      const to = timeRange?.to ?? null;
      const rows = await this.sql<AuditEventRow[]>`
        SELECT * FROM entity_audit_events
        WHERE workspace_id = ${workspaceId}
          AND entity_id = ${entityId}
          AND (${from}::timestamptz IS NULL OR timestamp >= ${from}::timestamptz)
          AND (${to}::timestamptz IS NULL OR timestamp <= ${to}::timestamptz)
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `;
      return ok(rows.map(rowToAuditEvent));
    } catch (e) {
      log.error('Failed to get entity history', { workspaceId, entityId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get value timeline for a specific field of an entity.
   *
   * @param workspaceId - Tenant workspace
   * @param entityId    - Entity to query
   * @param fieldName   - Attribute name to trace
   * @returns Timeline of field values ordered by timestamp
   */
  async getFieldHistory(
    workspaceId: string,
    entityId: string,
    fieldName: string,
  ): Promise<Result<FieldHistory, Error>> {
    const historyResult = await this.getHistory(workspaceId, entityId, undefined, 200);
    if (historyResult.isErr()) return err(historyResult.error);

    const timeline = historyResult.value
      .filter((e) => e.newValuesJson && fieldName in e.newValuesJson)
      .map((e) => ({
        timestamp: e.timestamp,
        value: e.newValuesJson?.[fieldName] ?? null,
        changedBy: e.changedBy,
      }))
      .reverse();

    return ok({ field: fieldName, timeline });
  }

  /**
   * Scan recent audit events for anomalous patterns.
   *
   * @param workspaceId - Tenant workspace
   * @param lookbackDays - Days to scan (default 7)
   * @returns List of detected anomalies with severity and details
   */
  async detectAnomalies(
    workspaceId: string,
    lookbackDays = 7,
  ): Promise<Result<AnomalyReport[], Error>> {
    try {
      type RapidRecreation = { entity_id: string; deletions: number; creations: number };
      type FrequentUpdates = { entity_id: string; update_count: number };
      type BulkDeletion = { bucket: Date; count: number };

      const [rapidRecreations, frequentUpdates, bulkDeletions] = await Promise.all([
        this.sql<RapidRecreation[]>`
          SELECT entity_id,
                 SUM(CASE WHEN change_type = 'deleted' THEN 1 ELSE 0 END)::INT AS deletions,
                 SUM(CASE WHEN change_type = 'created' THEN 1 ELSE 0 END)::INT AS creations
          FROM entity_audit_events
          WHERE workspace_id = ${workspaceId}
            AND timestamp > now() - ${lookbackDays} * interval '1 day'
          GROUP BY entity_id
          HAVING SUM(CASE WHEN change_type = 'deleted' THEN 1 ELSE 0 END) > 0
             AND SUM(CASE WHEN change_type = 'created' THEN 1 ELSE 0 END) > 0
        `,
        this.sql<FrequentUpdates[]>`
          SELECT entity_id, COUNT(*)::INT AS update_count
          FROM entity_audit_events
          WHERE workspace_id = ${workspaceId}
            AND change_type = 'updated'
            AND timestamp > now() - ${lookbackDays} * interval '1 day'
          GROUP BY entity_id
          HAVING COUNT(*) > 20
          ORDER BY update_count DESC
          LIMIT 10
        `,
        this.sql<BulkDeletion[]>`
          SELECT date_trunc('hour', timestamp) AS bucket, COUNT(*)::INT AS count
          FROM entity_audit_events
          WHERE workspace_id = ${workspaceId}
            AND change_type = 'deleted'
            AND timestamp > now() - ${lookbackDays} * interval '1 day'
          GROUP BY date_trunc('hour', timestamp)
          HAVING COUNT(*) > 50
          ORDER BY count DESC
          LIMIT 5
        `,
      ]);

      const anomalies: AnomalyReport[] = [];
      const now = new Date();

      for (const r of rapidRecreations) {
        anomalies.push({
          entityId: r.entity_id,
          anomalyType: 'rapid_recreation',
          severity: r.deletions > 2 ? 'high' : 'medium',
          details: `Entity deleted ${r.deletions}x and recreated ${r.creations}x within ${lookbackDays} days`,
          detectedAt: now,
        });
      }

      for (const r of frequentUpdates) {
        anomalies.push({
          entityId: r.entity_id,
          anomalyType: 'frequent_updates',
          severity: r.update_count > 100 ? 'high' : 'low',
          details: `${r.update_count} updates in ${lookbackDays} days`,
          detectedAt: now,
        });
      }

      for (const r of bulkDeletions) {
        anomalies.push({
          entityId: 'bulk',
          anomalyType: 'bulk_deletion',
          severity: r.count > 200 ? 'high' : 'medium',
          details: `${r.count} entities deleted in a single hour (${String(r.bucket)})`,
          detectedAt: now,
        });
      }

      log.info('Anomaly detection complete', { workspaceId, anomalies: anomalies.length });
      return ok(anomalies);
    } catch (e) {
      log.error('Anomaly detection failed', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List recent audit events across all entities for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param entityType  - Optional entity type filter
   * @param limit       - Max events to return (default 50)
   */
  async listRecentEvents(
    workspaceId: string,
    entityType?: string,
    limit = 50,
  ): Promise<Result<AuditEvent[], Error>> {
    try {
      const rows = await this.sql<AuditEventRow[]>`
        SELECT * FROM entity_audit_events
        WHERE workspace_id = ${workspaceId}
          AND (${entityType ?? null}::text IS NULL OR entity_type = ${entityType ?? null})
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `;
      return ok(rows.map(rowToAuditEvent));
    } catch (e) {
      log.error('Failed to list audit events', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
