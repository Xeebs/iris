import { randomBytes } from 'crypto';
import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

export type ChangeType = 'created' | 'updated' | 'deleted' | 'attribute_changed';

export type EntityChange = {
  changeId: string;
  entityId: string;
  entityType: string;
  changeType: ChangeType;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  source: string;
  workspaceId: string;
  changedAt: Date;
};

export type SubscriptionFilters = {
  entityTypes?: string[];
  changeTypes?: ChangeType[];
  connectorIds?: string[];
};

export type Subscription = {
  subscriptionId: string;
  entityId: string | null;
  workspaceId: string;
  filters: SubscriptionFilters;
  createdAt: Date;
  active: boolean;
};

type ChangeRow = {
  change_id: string;
  entity_id: string;
  entity_type: string;
  change_type: ChangeType;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  source: string;
  workspace_id: string;
  changed_at: Date;
};

type SubRow = {
  subscription_id: string;
  entity_id: string | null;
  workspace_id: string;
  filters: SubscriptionFilters;
  created_at: Date;
  active: boolean;
};

type Listener = (change: EntityChange) => void;

export class EntityChangeStreamManager {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly sql: Sql) {}

  /**
   * Creates a subscription for entity change events.
   * @param workspaceId - Workspace scope
   * @param entityId - Specific entity ID to watch, or null for all entities
   * @param filters - Optional filters on entity types, change types, connector IDs
   * @returns The created subscription
   */
  async subscribeToEntityChanges(
    workspaceId: string,
    entityId: string | null,
    filters: SubscriptionFilters = {}
  ): Promise<Subscription> {
    const subscriptionId = randomBytes(16).toString('hex');
    const now = new Date();

    await this.sql`
      INSERT INTO entity_change_subscriptions (
        subscription_id, entity_id, workspace_id, filters, created_at, active
      ) VALUES (
        ${subscriptionId},
        ${entityId ?? null},
        ${workspaceId},
        ${JSON.stringify(filters)},
        ${now},
        true
      )
    `;

    logger.info('Entity change subscription created', {
      subscriptionId,
      workspaceId,
      entityId,
    });

    return {
      subscriptionId,
      entityId,
      workspaceId,
      filters,
      createdAt: now,
      active: true,
    };
  }

  /**
   * Cancels an existing subscription.
   * @param subscriptionId - Subscription to deactivate
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    await this.sql`
      UPDATE entity_change_subscriptions
      SET active = false
      WHERE subscription_id = ${subscriptionId}
    `;

    this.listeners.delete(subscriptionId);
    logger.info('Entity change subscription cancelled', { subscriptionId });
  }

  /**
   * Emits an entity change event — persists to DB and notifies in-process listeners.
   * @param change - The change event (changeId generated if omitted)
   */
  async emitEntityChange(change: Omit<EntityChange, 'changeId'> & { changeId?: string }): Promise<EntityChange> {
    const changeId = change.changeId ?? randomBytes(16).toString('hex');
    const full: EntityChange = { changeId, ...change };

    await this.sql`
      INSERT INTO entity_change_events (
        change_id, entity_id, entity_type, change_type,
        previous_value, new_value, source, workspace_id, changed_at
      ) VALUES (
        ${changeId},
        ${change.entityId},
        ${change.entityType},
        ${change.changeType},
        ${change.previousValue ? JSON.stringify(change.previousValue) : null},
        ${change.newValue ? JSON.stringify(change.newValue) : null},
        ${change.source},
        ${change.workspaceId},
        ${change.changedAt}
      )
      ON CONFLICT (change_id) DO NOTHING
    `;

    // Dispatch to in-process listeners (SSE handlers)
    for (const [, set] of this.listeners) {
      for (const fn of set) {
        try {
          fn(full);
        } catch {
          // listeners must not crash emitters
        }
      }
    }

    logger.debug('Entity change emitted', {
      changeId,
      entityId: change.entityId,
      changeType: change.changeType,
    });

    return full;
  }

  /**
   * Generates a human-readable notification string for a change event.
   * @param change - The change to describe
   * @returns Human-readable notification text
   */
  createChangeNotification(change: EntityChange): string {
    const who = change.source ? ` (via ${change.source})` : '';
    switch (change.changeType) {
      case 'created':
        return `${change.entityType} ${change.entityId} was created${who}.`;
      case 'deleted':
        return `${change.entityType} ${change.entityId} was deleted${who}.`;
      case 'updated': {
        const changed = change.newValue
          ? Object.keys(change.newValue).join(', ')
          : 'unknown fields';
        return `${change.entityType} ${change.entityId} was updated: ${changed}${who}.`;
      }
      case 'attribute_changed': {
        const entries: string[] = [];
        if (change.previousValue && change.newValue) {
          for (const key of Object.keys(change.newValue)) {
            const prev = change.previousValue[key];
            const next = change.newValue[key];
            if (prev !== next) {
              entries.push(`${key} changed from "${prev}" to "${next}"`);
            }
          }
        }
        const desc = entries.length > 0 ? entries.join('; ') : 'attributes changed';
        return `${change.entityType} ${change.entityId}: ${desc}${who}.`;
      }
      default:
        return `${change.entityType} ${change.entityId} changed${who}.`;
    }
  }

  /**
   * Registers a listener for a given subscription (used by SSE stream handlers).
   * @param subscriptionId - Subscription ID
   * @param listener - Callback for each incoming change
   * @returns Cleanup function
   */
  addListener(subscriptionId: string, listener: Listener): () => void {
    if (!this.listeners.has(subscriptionId)) {
      this.listeners.set(subscriptionId, new Set());
    }
    this.listeners.get(subscriptionId)!.add(listener);

    return () => {
      this.listeners.get(subscriptionId)?.delete(listener);
    };
  }

  /**
   * Returns active subscriptions for a workspace.
   * @param workspaceId - Workspace scope
   * @returns Active subscriptions
   */
  async getActiveSubscriptions(workspaceId: string): Promise<Subscription[]> {
    const rows = await this.sql<SubRow[]>`
      SELECT subscription_id, entity_id, workspace_id, filters, created_at, active
      FROM entity_change_subscriptions
      WHERE workspace_id = ${workspaceId} AND active = true
      ORDER BY created_at DESC
    `;

    return rows.map((r) => ({
      subscriptionId: r.subscription_id,
      entityId: r.entity_id,
      workspaceId: r.workspace_id,
      filters: r.filters,
      createdAt: r.created_at,
      active: r.active,
    }));
  }

  /**
   * Replays past entity change events since a given timestamp.
   * @param entityId - Entity ID to replay changes for
   * @param workspaceId - Workspace scope
   * @param sinceTimestamp - Only return changes after this time
   * @param limit - Max events to return
   * @returns Historical change events in chronological order
   */
  async replayChanges(
    entityId: string,
    workspaceId: string,
    sinceTimestamp: Date,
    limit = 50
  ): Promise<EntityChange[]> {
    const rows = await this.sql<ChangeRow[]>`
      SELECT change_id, entity_id, entity_type, change_type,
             previous_value, new_value, source, workspace_id, changed_at
      FROM entity_change_events
      WHERE entity_id = ${entityId}
        AND workspace_id = ${workspaceId}
        AND changed_at > ${sinceTimestamp}
      ORDER BY changed_at ASC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      changeId: r.change_id,
      entityId: r.entity_id,
      entityType: r.entity_type,
      changeType: r.change_type,
      previousValue: r.previous_value,
      newValue: r.new_value,
      source: r.source,
      workspaceId: r.workspace_id,
      changedAt: r.changed_at,
    }));
  }

  /**
   * Returns recent change events for a workspace with optional entity type filter.
   * @param workspaceId - Workspace scope
   * @param entityType - Optional entity type filter
   * @param limit - Max events
   * @returns Change events sorted newest first
   */
  async getRecentChanges(
    workspaceId: string,
    entityType: string | null,
    limit = 50
  ): Promise<EntityChange[]> {
    const rows = entityType
      ? await this.sql<ChangeRow[]>`
          SELECT change_id, entity_id, entity_type, change_type,
                 previous_value, new_value, source, workspace_id, changed_at
          FROM entity_change_events
          WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
          ORDER BY changed_at DESC
          LIMIT ${limit}
        `
      : await this.sql<ChangeRow[]>`
          SELECT change_id, entity_id, entity_type, change_type,
                 previous_value, new_value, source, workspace_id, changed_at
          FROM entity_change_events
          WHERE workspace_id = ${workspaceId}
          ORDER BY changed_at DESC
          LIMIT ${limit}
        `;

    return rows.map((r) => ({
      changeId: r.change_id,
      entityId: r.entity_id,
      entityType: r.entity_type,
      changeType: r.change_type,
      previousValue: r.previous_value,
      newValue: r.new_value,
      source: r.source,
      workspaceId: r.workspace_id,
      changedAt: r.changed_at,
    }));
  }
}
