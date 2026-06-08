import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'mcp-subscriptions' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationEventType = 'entity.created' | 'entity.updated' | 'entity.deleted';

export interface NotificationEvent {
  type: NotificationEventType;
  entityId: string;
  entityType: string;
  workspaceId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export const subscriptionFiltersSchema = z.object({
  entityTypes: z.array(z.string()).optional(),
  connectorIds: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  callbackUrl: z.string().url().optional(),
});

export const createSubscriptionSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  filters: subscriptionFiltersSchema.optional().default({}),
});

export type SubscriptionFilters = z.infer<typeof subscriptionFiltersSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export interface Subscription {
  id: string;
  workspaceId: string;
  clientId: string;
  filters: SubscriptionFilters;
  createdAt: Date;
  lastNotifiedAt: Date | null;
}

// ─── DB row types ─────────────────────────────────────────────────────────────

interface SubscriptionRow {
  id: string;
  workspace_id: string;
  client_id: string;
  filters_json: string;
  created_at: string;
  last_notified_at: string | null;
}

interface NotificationEventRow {
  event_id: string;
  subscription_id: string;
  notification_type: NotificationEventType;
  entity_id: string;
  payload_json: string;
  delivered_at: string | null;
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  const filters = (() => {
    try {
      return subscriptionFiltersSchema.parse(JSON.parse(row.filters_json));
    } catch {
      return {};
    }
  })();
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    filters,
    createdAt: new Date(row.created_at),
    lastNotifiedAt: row.last_notified_at ? new Date(row.last_notified_at) : null,
  };
}

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Manages MCP change subscriptions and broadcasts entity change notifications
 * to subscribed clients. Clients can filter by entity type, connector, or keyword.
 * Optional webhook callback_url receives POST requests for each matching event.
 */
export class MCPSubscriptionManager {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Creates a new subscription for a client.
   * @param input - Validated subscription creation input
   * @returns The created Subscription
   */
  async subscribe(input: CreateSubscriptionInput): Promise<Result<Subscription, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO mcp_subscriptions (workspace_id, client_id, filters_json)
        VALUES (${input.workspaceId}, ${input.clientId}, ${JSON.stringify(input.filters ?? {})})
        RETURNING id, workspace_id, client_id, filters_json, created_at, last_notified_at
      ` as SubscriptionRow[];

      const row = rows[0];
      if (!row) return err(new Error('Failed to create subscription'));

      log.info('Subscription created', { id: row.id, clientId: input.clientId, workspaceId: input.workspaceId });
      return ok(rowToSubscription(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Removes a subscription by ID.
   * @param subscriptionId - ID of the subscription to remove
   * @param workspaceId - Workspace that owns the subscription (for authorization)
   */
  async unsubscribe(subscriptionId: string, workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM mcp_subscriptions
        WHERE id = ${subscriptionId} AND workspace_id = ${workspaceId}
      `;
      log.info('Subscription removed', { subscriptionId, workspaceId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists all active subscriptions for a workspace.
   * @param workspaceId - Target workspace
   */
  async listSubscriptions(workspaceId: string): Promise<Result<Subscription[], Error>> {
    try {
      const rows = await this.sql`
        SELECT id, workspace_id, client_id, filters_json, created_at, last_notified_at
        FROM mcp_subscriptions
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
      ` as SubscriptionRow[];

      return ok(rows.map(rowToSubscription));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Evaluates whether an event matches a subscription's filters.
   * @param event - The change event to evaluate
   * @param filters - Subscription filters to test against
   */
  matchesFilters(event: NotificationEvent, filters: SubscriptionFilters): boolean {
    if (filters.entityTypes?.length && !filters.entityTypes.includes(event.entityType)) {
      return false;
    }
    if (filters.connectorIds?.length) {
      const connectorId = event.payload['sourceConnectorId'] as string | undefined;
      if (!connectorId || !filters.connectorIds.includes(connectorId)) return false;
    }
    if (filters.keywords?.length) {
      const label = (event.payload['label'] as string | undefined ?? '').toLowerCase();
      const hasKeyword = filters.keywords.some((kw) => label.includes(kw.toLowerCase()));
      if (!hasKeyword) return false;
    }
    return true;
  }

  /**
   * Broadcasts a change event to all matching subscriptions.
   * For subscriptions with callbackUrl, sends a POST request.
   * @param event - The entity change event to broadcast
   */
  async notifyClients(event: NotificationEvent): Promise<Result<number, Error>> {
    try {
      const rows = await this.sql`
        SELECT id, workspace_id, client_id, filters_json, created_at, last_notified_at
        FROM mcp_subscriptions
        WHERE workspace_id = ${event.workspaceId}
      ` as SubscriptionRow[];

      const subscriptions = rows.map(rowToSubscription);
      const matching = subscriptions.filter((s) => this.matchesFilters(event, s.filters));

      if (matching.length === 0) return ok(0);

      // Record notification events
      for (const sub of matching) {
        await this.sql`
          INSERT INTO mcp_notification_events (subscription_id, notification_type, entity_id, payload_json)
          VALUES (${sub.id}, ${event.type}, ${event.entityId}, ${JSON.stringify(event.payload)})
        `.catch(() => null);

        // Fire webhook if callbackUrl is set
        if (sub.filters.callbackUrl) {
          void this.deliverWebhook(sub.filters.callbackUrl, event, sub.id);
        }

        // Update last_notified_at
        await this.sql`
          UPDATE mcp_subscriptions SET last_notified_at = NOW() WHERE id = ${sub.id}
        `.catch(() => null);
      }

      log.info('Notifications sent', { eventType: event.type, entityId: event.entityId, recipients: matching.length });
      return ok(matching.length);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists recent notification events for a subscription.
   * @param subscriptionId - Target subscription
   * @param limit - Max events to return
   */
  async listEvents(subscriptionId: string, limit = 50): Promise<Result<NotificationEventRow[], Error>> {
    try {
      const rows = await this.sql`
        SELECT event_id, subscription_id, notification_type, entity_id, payload_json, delivered_at
        FROM mcp_notification_events
        WHERE subscription_id = ${subscriptionId}
        ORDER BY delivered_at DESC NULLS LAST
        LIMIT ${Math.min(limit, 200)}
      ` as NotificationEventRow[];

      return ok(rows);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private async deliverWebhook(url: string, event: NotificationEvent, subscriptionId: string): Promise<void> {
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 10_000);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-iris-subscription-id': subscriptionId },
        body: JSON.stringify(event),
        signal: ac.signal,
      });
      clearTimeout(timeout);
      log.debug('Webhook delivered', { url, subscriptionId });
    } catch (e) {
      log.warn('Webhook delivery failed', { url, subscriptionId, error: (e as Error).message });
    }
  }
}
