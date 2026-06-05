import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'sync-events' });

export type SyncEventType = 'sync_started' | 'sync_completed' | 'sync_failed';

export type SyncEvent = {
  connectorInstanceId: string;
  workspaceId: string;
  eventType: SyncEventType;
  timestamp: Date;
  metadata?: Record<string, unknown>;
};

/**
 * Emit a structured sync lifecycle event.
 * Events are logged for observability; extend to persist in DB as needed.
 *
 * @param event - Sync lifecycle event
 */
export function emitSyncEvent(event: SyncEvent): void {
  const logFn = event.eventType === 'sync_failed' ? log.error : log.info;
  logFn(`Sync event: ${event.eventType}`, {
    connectorInstanceId: event.connectorInstanceId,
    workspaceId: event.workspaceId,
    eventType: event.eventType,
    ...event.metadata,
  });
}
