import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'event-driven-sync-engine' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type ChangeType = 'entity_created' | 'entity_updated' | 'entity_deleted' | 'relationship_changed';
export type EventStatus = 'pending' | 'delivered' | 'failed';

export type EntityChangeEvent = {
  eventId: string;
  connectorId: string;
  workspaceId: string;
  entityId: string;
  entityType: string;
  changeType: ChangeType;
  payload: Record<string, unknown>;
  occurredAt: Date;
  schemaVersion: string;
};

export type EventStreamConfig = {
  connectorId: string;
  workspaceId: string;
  enabled: boolean;
  eventTypes: ChangeType[];
  configJson: Record<string, unknown>;
};

export type DeliveredEvent = {
  eventId: string;
  status: EventStatus;
  retryCount: number;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
};

export type EventAuditEntry = {
  eventId: string;
  connectorId: string;
  entityId: string;
  changeType: ChangeType;
  changeSummary: string;
  deliveredAt: Date | null;
  latencyMs: number | null;
};

export type BatchCoalesceResult = {
  coalescedEvents: EntityChangeEvent[];
  droppedCount: number;
  batchedByType: Record<string, number>;
};

/**
 * Validate an entity change event structure.
 * @param event - Event to validate
 */
export function validateChangeEvent(event: unknown): event is EntityChangeEvent {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;
  return (
    typeof e['eventId'] === 'string' &&
    typeof e['connectorId'] === 'string' &&
    typeof e['workspaceId'] === 'string' &&
    typeof e['entityId'] === 'string' &&
    typeof e['entityType'] === 'string' &&
    typeof e['changeType'] === 'string' &&
    ['entity_created', 'entity_updated', 'entity_deleted', 'relationship_changed'].includes(e['changeType'] as string) &&
    e['occurredAt'] instanceof Date
  );
}

/**
 * Batch coalesce events within a time window, keeping only the latest per entity.
 * @param events - Raw events from the stream
 * @param timeWindowMs - Window size in milliseconds
 */
export function batchCoalesceEvents(
  events: EntityChangeEvent[],
  timeWindowMs = 500,
): BatchCoalesceResult {
  const now = Date.now();
  const windowStart = new Date(now - timeWindowMs);

  // Filter to events within window
  const inWindow = events.filter(e => e.occurredAt >= windowStart);

  // For each entity, keep only the latest event
  const latestByEntity = new Map<string, EntityChangeEvent>();
  for (const event of inWindow) {
    const key = `${event.connectorId}:${event.entityId}`;
    const existing = latestByEntity.get(key);
    if (!existing || event.occurredAt > existing.occurredAt) {
      latestByEntity.set(key, event);
    }
  }

  const coalescedEvents = [...latestByEntity.values()];
  const droppedCount = inWindow.length - coalescedEvents.length;

  const batchedByType: Record<string, number> = {};
  for (const e of coalescedEvents) {
    batchedByType[e.changeType] = (batchedByType[e.changeType] ?? 0) + 1;
  }

  return { coalescedEvents, droppedCount, batchedByType };
}

/**
 * Compute a change summary string for audit logging.
 * @param event - Entity change event
 */
export function computeChangeSummary(event: EntityChangeEvent): string {
  const fieldCount = Object.keys(event.payload).length;
  switch (event.changeType) {
    case 'entity_created':
      return `Created ${event.entityType} with ${fieldCount} fields`;
    case 'entity_updated':
      return `Updated ${event.entityType}: ${fieldCount} fields changed`;
    case 'entity_deleted':
      return `Deleted ${event.entityType}`;
    case 'relationship_changed':
      return `Relationship changed on ${event.entityType}`;
  }
}

/**
 * Determine which cache keys are invalidated by a change event.
 * @param event - The triggering change event
 */
export function computeCacheInvalidationKeys(event: EntityChangeEvent): string[] {
  const keys: string[] = [
    `entity:${event.workspaceId}:${event.entityId}`,
    `entities:${event.workspaceId}:${event.entityType}`,
    `context:${event.workspaceId}`,
  ];
  if (event.changeType === 'relationship_changed') {
    keys.push(`relationships:${event.workspaceId}:${event.entityId}`);
  }
  return keys;
}

/**
 * Process a single change event: validate, enrich, and write to audit log.
 * @param sql - SQL function
 * @param event - Entity change event to process
 * @param startTime - Processing start timestamp for latency tracking
 */
export async function processChangeEvent(
  sql: SqlFn,
  event: EntityChangeEvent,
  startTime = Date.now(),
): Promise<Result<void, Error>> {
  try {
    if (!validateChangeEvent(event)) {
      return err(new Error(`Invalid event structure: eventId=${String((event as Record<string, unknown>)['eventId'])}`));
    }

    const summary = computeChangeSummary(event);
    const latencyMs = Date.now() - startTime;

    await sql`
      INSERT INTO event_audit_log (
        event_id, connector_id, entity_id, change_type, change_summary,
        delivered_at, latency_ms, workspace_id
      ) VALUES (
        ${event.eventId}, ${event.connectorId}, ${event.entityId},
        ${event.changeType}, ${summary}, NOW(), ${latencyMs}, ${event.workspaceId}
      )
      ON CONFLICT (event_id) DO UPDATE SET
        delivered_at = NOW(),
        latency_ms = EXCLUDED.latency_ms
    `;

    await sql`
      UPDATE event_delivery_queue
      SET status = 'delivered', retry_count = retry_count, next_retry_at = NULL
      WHERE event_id = ${event.eventId} AND workspace_id = ${event.workspaceId}
    `;

    log.info('Change event processed', {
      eventId: event.eventId,
      connectorId: event.connectorId,
      entityType: event.entityType,
      changeType: event.changeType,
      latencyMs,
    });

    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Enqueue a change event for processing and delivery.
 * @param sql - SQL function
 * @param event - Event to enqueue
 */
export async function enqueueChangeEvent(
  sql: SqlFn,
  event: EntityChangeEvent,
): Promise<Result<void, Error>> {
  try {
    await sql`
      INSERT INTO event_delivery_queue (
        event_id, workspace_id, connector_id, entity_id, entity_type,
        change_type, payload_json, status, retry_count, next_retry_at, occurred_at
      ) VALUES (
        ${event.eventId}, ${event.workspaceId}, ${event.connectorId},
        ${event.entityId}, ${event.entityType}, ${event.changeType},
        ${JSON.stringify(event.payload)}, 'pending', 0, NULL, ${event.occurredAt}
      )
      ON CONFLICT (event_id) DO NOTHING
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get pending events that need retry, ordered by next_retry_at.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param limit - Max events to fetch
 */
export async function getPendingRetryEvents(
  sql: SqlFn,
  workspaceId: string,
  limit = 50,
): Promise<Result<DeliveredEvent[], Error>> {
  try {
    const rows = await sql`
      SELECT event_id, status, retry_count, next_retry_at, delivered_at
      FROM event_delivery_queue
      WHERE workspace_id = ${workspaceId}
        AND status = 'failed'
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY next_retry_at ASC NULLS FIRST
      LIMIT ${limit}
    ` as unknown as Array<{
      event_id: string;
      status: EventStatus;
      retry_count: number;
      next_retry_at: string | null;
      delivered_at: string | null;
    }>;

    return ok(rows.map(r => ({
      eventId: r.event_id,
      status: r.status,
      retryCount: r.retry_count,
      nextRetryAt: r.next_retry_at ? new Date(r.next_retry_at) : null,
      deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    })));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Mark an event as failed and schedule retry with exponential backoff.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param eventId - Event to mark failed
 * @param maxRetries - Max retry attempts before giving up
 */
export async function markEventFailed(
  sql: SqlFn,
  workspaceId: string,
  eventId: string,
  maxRetries = 3,
): Promise<Result<void, Error>> {
  try {
    const rows = await sql`
      SELECT retry_count FROM event_delivery_queue
      WHERE event_id = ${eventId} AND workspace_id = ${workspaceId}
    ` as unknown as Array<{ retry_count: number }>;

    const retryCount = rows[0]?.retry_count ?? 0;

    if (retryCount >= maxRetries) {
      await sql`
        UPDATE event_delivery_queue
        SET status = 'failed', retry_count = ${retryCount + 1}, next_retry_at = NULL
        WHERE event_id = ${eventId} AND workspace_id = ${workspaceId}
      `;
    } else {
      // Exponential backoff: 2^retryCount * 30s
      const backoffMs = Math.pow(2, retryCount) * 30_000;
      const nextRetry = new Date(Date.now() + backoffMs);
      await sql`
        UPDATE event_delivery_queue
        SET status = 'failed', retry_count = ${retryCount + 1}, next_retry_at = ${nextRetry}
        WHERE event_id = ${eventId} AND workspace_id = ${workspaceId}
      `;
    }

    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get event stream configuration for a connector.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param connectorId - Connector to get config for
 */
export async function getEventStreamConfig(
  sql: SqlFn,
  workspaceId: string,
  connectorId: string,
): Promise<Result<EventStreamConfig | null, Error>> {
  try {
    const rows = await sql`
      SELECT connector_id, workspace_id, enabled, event_types, config_json
      FROM connector_event_streams
      WHERE workspace_id = ${workspaceId} AND connector_id = ${connectorId}
    ` as unknown as Array<{
      connector_id: string;
      workspace_id: string;
      enabled: boolean;
      event_types: ChangeType[];
      config_json: Record<string, unknown>;
    }>;

    if (rows.length === 0) return ok(null);
    const r = rows[0]!;
    return ok({
      connectorId: r.connector_id,
      workspaceId: r.workspace_id,
      enabled: r.enabled,
      eventTypes: r.event_types,
      configJson: r.config_json,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Upsert event stream configuration for a connector.
 * @param sql - SQL function
 * @param config - Stream configuration to save
 */
export async function upsertEventStreamConfig(
  sql: SqlFn,
  config: EventStreamConfig,
): Promise<Result<void, Error>> {
  try {
    await sql`
      INSERT INTO connector_event_streams (
        workspace_id, connector_id, enabled, event_types, config_json
      ) VALUES (
        ${config.workspaceId}, ${config.connectorId}, ${config.enabled},
        ${config.eventTypes}, ${JSON.stringify(config.configJson)}
      )
      ON CONFLICT (workspace_id, connector_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        event_types = EXCLUDED.event_types,
        config_json = EXCLUDED.config_json
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Fetch audit log entries for a workspace.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param limit - Max entries
 * @param cursor - Pagination cursor (event_id of last seen entry)
 */
export async function getEventAuditLog(
  sql: SqlFn,
  workspaceId: string,
  limit = 50,
  cursor?: string,
): Promise<Result<{ entries: EventAuditEntry[]; nextCursor: string | null }, Error>> {
  try {
    const rows = cursor
      ? await sql`
          SELECT event_id, connector_id, entity_id, change_type, change_summary,
                 delivered_at, latency_ms
          FROM event_audit_log
          WHERE workspace_id = ${workspaceId}
            AND event_id < ${cursor}
          ORDER BY delivered_at DESC NULLS LAST, event_id DESC
          LIMIT ${limit + 1}
        ` as unknown as Array<{
          event_id: string;
          connector_id: string;
          entity_id: string;
          change_type: ChangeType;
          change_summary: string;
          delivered_at: string | null;
          latency_ms: number | null;
        }>
      : await sql`
          SELECT event_id, connector_id, entity_id, change_type, change_summary,
                 delivered_at, latency_ms
          FROM event_audit_log
          WHERE workspace_id = ${workspaceId}
          ORDER BY delivered_at DESC NULLS LAST, event_id DESC
          LIMIT ${limit + 1}
        ` as unknown as Array<{
          event_id: string;
          connector_id: string;
          entity_id: string;
          change_type: ChangeType;
          change_summary: string;
          delivered_at: string | null;
          latency_ms: number | null;
        }>;

    const hasMore = rows.length > limit;
    const entries = rows.slice(0, limit).map(r => ({
      eventId: r.event_id,
      connectorId: r.connector_id,
      entityId: r.entity_id,
      changeType: r.change_type,
      changeSummary: r.change_summary,
      deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
      latencyMs: r.latency_ms ?? null,
    }));

    return ok({
      entries,
      nextCursor: hasMore ? entries[entries.length - 1]!.eventId : null,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
