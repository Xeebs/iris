import { z } from 'zod';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'mcp-subscription-manager' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationEventType = 'entity.created' | 'entity.updated' | 'entity.deleted';

export interface MCPNotification {
  type: NotificationEventType;
  entityId: string;
  entityType: string;
  workspaceId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export const subscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  subscriptionId: z.string().uuid(),
  workspaceId: z.string(),
  filters: z.object({
    entityTypes: z.array(z.string()).optional(),
    connectorIds: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
  }).optional().default({}),
});

export const unsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  subscriptionId: z.string().uuid(),
});

export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;
export type UnsubscribeMessage = z.infer<typeof unsubscribeMessageSchema>;

interface ActiveSubscription {
  subscriptionId: string;
  workspaceId: string;
  filters: SubscribeMessage['filters'];
  notify: (notification: MCPNotification) => void;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

/**
 * In-process MCP subscription manager for the MCP server.
 * Maintains an in-memory map of active subscriptions; the persistent record
 * is stored via the REST API (mcp-subscriptions route in apps/api).
 */
export class MCPServerSubscriptionManager {
  private readonly subscriptions = new Map<string, ActiveSubscription>();

  /**
   * Registers an in-process subscription with a notification callback.
   * @param msg - Validated subscribe message
   * @param notify - Callback invoked when a matching notification arrives
   */
  register(msg: SubscribeMessage, notify: (n: MCPNotification) => void): void {
    this.subscriptions.set(msg.subscriptionId, {
      subscriptionId: msg.subscriptionId,
      workspaceId: msg.workspaceId,
      filters: msg.filters,
      notify,
    });
    log.info('Subscription registered', { subscriptionId: msg.subscriptionId, workspaceId: msg.workspaceId });
  }

  /**
   * Removes an in-process subscription.
   * @param subscriptionId - ID of the subscription to remove
   */
  deregister(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
    log.info('Subscription deregistered', { subscriptionId });
  }

  /**
   * Returns the number of active in-process subscriptions.
   */
  get size(): number {
    return this.subscriptions.size;
  }

  /**
   * Dispatches a change notification to all matching in-process subscribers.
   * @param notification - The entity change notification to dispatch
   * @returns Number of subscribers notified
   */
  dispatch(notification: MCPNotification): number {
    let notified = 0;
    for (const sub of this.subscriptions.values()) {
      if (sub.workspaceId !== notification.workspaceId) continue;
      if (!this.filtersMatch(notification, sub.filters)) continue;
      try {
        sub.notify(notification);
        notified++;
      } catch (e) {
        log.warn('Notification delivery failed', { subscriptionId: sub.subscriptionId, error: (e as Error).message });
      }
    }
    log.debug('Notification dispatched', { eventType: notification.type, notified });
    return notified;
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private filtersMatch(notification: MCPNotification, filters: SubscribeMessage['filters']): boolean {
    if (filters.entityTypes?.length && !filters.entityTypes.includes(notification.entityType)) {
      return false;
    }
    if (filters.connectorIds?.length) {
      const connId = notification.payload['sourceConnectorId'] as string | undefined;
      if (!connId || !filters.connectorIds.includes(connId)) return false;
    }
    if (filters.keywords?.length) {
      const label = (notification.payload['label'] as string | undefined ?? '').toLowerCase();
      const match = filters.keywords.some((kw) => label.includes(kw.toLowerCase()));
      if (!match) return false;
    }
    return true;
  }
}
