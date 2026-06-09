import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { EntityChangeStreamManager } from '@iris/semantic-core/entity-change-stream';
import type { ChangeType } from '@iris/semantic-core/entity-change-stream';

const CreateSubscriptionSchema = z.object({
  entityId: z.string().nullable().default(null),
  entityTypes: z.array(z.string()).optional(),
  changeTypes: z.array(z.enum(['created', 'updated', 'deleted', 'attribute_changed'])).optional(),
  connectorIds: z.array(z.string()).optional(),
});

const UpdateFiltersSchema = z.object({
  entityTypes: z.array(z.string()).optional(),
  changeTypes: z.array(z.enum(['created', 'updated', 'deleted', 'attribute_changed'])).optional(),
  connectorIds: z.array(z.string()).optional(),
});

type SubRow = {
  subscription_id: string;
  entity_id: string | null;
  workspace_id: string;
  filters: { entityTypes?: string[]; changeTypes?: string[]; connectorIds?: string[] };
  created_at: Date;
  active: boolean;
};

type EventRow = {
  change_id: string;
  entity_id: string;
  entity_type: string;
  change_type: ChangeType;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  source: string;
  changed_at: Date;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for entity change subscription management
 */
export function createEntityChangeSubscriptionsRoutes(sql: Sql) {
  const app = new Hono();
  const manager = new EntityChangeStreamManager(sql);

  // POST /subscriptions — create subscription
  app.post('/', zValidator('json', CreateSubscriptionSchema), async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';
    const body = c.req.valid('json');

    try {
      const rawFilters = {
        entityTypes: body.entityTypes,
        changeTypes: body.changeTypes as ChangeType[] | undefined,
        connectorIds: body.connectorIds,
      };
      const cleanFilters = Object.fromEntries(Object.entries(rawFilters).filter(([, v]) => v !== undefined)) as Parameters<typeof manager.subscribeToEntityChanges>[2];
      const subscription = await manager.subscribeToEntityChanges(workspaceId, body.entityId, cleanFilters);
      return c.json({ data: subscription }, 201);
    } catch {
      return c.json({ error: { code: 'CREATE_FAILED', message: 'Failed to create subscription' } }, 500);
    }
  });

  // GET /subscriptions — list subscriptions for workspace
  app.get('/', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';
    const cursor = c.req.query('cursor');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    try {
      let rows: SubRow[];
      if (cursor) {
        rows = await sql`
          SELECT subscription_id, entity_id, workspace_id, filters, created_at, active
          FROM entity_change_subscriptions
          WHERE workspace_id = ${workspaceId} AND active = true
            AND subscription_id > ${cursor}
          ORDER BY subscription_id
          LIMIT ${limit + 1}
        ` as SubRow[];
      } else {
        rows = await sql`
          SELECT subscription_id, entity_id, workspace_id, filters, created_at, active
          FROM entity_change_subscriptions
          WHERE workspace_id = ${workspaceId} AND active = true
          ORDER BY subscription_id
          LIMIT ${limit + 1}
        ` as SubRow[];
      }

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? page[page.length - 1]!.subscription_id : null;

      return c.json({
        data: page.map(rowToSubscription),
        meta: { hasMore, nextCursor },
      });
    } catch {
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to list subscriptions' } }, 500);
    }
  });

  // PUT /subscriptions/:id — update subscription filters
  app.put('/:id', zValidator('json', UpdateFiltersSchema), async (c) => {
    const subscriptionId = c.req.param('id');
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';
    const filters = c.req.valid('json');

    try {
      const rows = await sql`
        UPDATE entity_change_subscriptions
        SET filters = ${JSON.stringify(filters)}
        WHERE subscription_id = ${subscriptionId}
          AND workspace_id = ${workspaceId}
          AND active = true
        RETURNING subscription_id, entity_id, workspace_id, filters, created_at, active
      ` as SubRow[];

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Subscription not found' } }, 404);
      }

      return c.json({ data: rowToSubscription(rows[0]!) });
    } catch {
      return c.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to update subscription' } }, 500);
    }
  });

  // DELETE /subscriptions/:id — unsubscribe
  app.delete('/:id', async (c) => {
    const subscriptionId = c.req.param('id');
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';

    try {
      const rows = await sql`
        UPDATE entity_change_subscriptions
        SET active = false
        WHERE subscription_id = ${subscriptionId}
          AND workspace_id = ${workspaceId}
        RETURNING subscription_id
      ` as Array<{ subscription_id: string }>;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Subscription not found' } }, 404);
      }

      await manager.unsubscribe(subscriptionId);
      return c.json({ data: { subscriptionId, cancelled: true } });
    } catch {
      return c.json({ error: { code: 'DELETE_FAILED', message: 'Failed to cancel subscription' } }, 500);
    }
  });

  // GET /subscriptions/:id/events — paginated change event history
  app.get('/:id/events', async (c) => {
    const subscriptionId = c.req.param('id');
    const workspaceId = c.req.header('x-workspace-id') ?? 'unknown';
    const cursor = c.req.query('cursor');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    try {
      // Verify subscription belongs to workspace
      const subs = await sql`
        SELECT entity_id FROM entity_change_subscriptions
        WHERE subscription_id = ${subscriptionId} AND workspace_id = ${workspaceId}
      ` as Array<{ entity_id: string | null }>;

      if (subs.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Subscription not found' } }, 404);
      }

      const entityId = subs[0]!.entity_id;
      let rows: EventRow[];

      if (entityId) {
        if (cursor) {
          rows = await sql`
            SELECT change_id, entity_id, entity_type, change_type,
                   previous_value, new_value, source, changed_at
            FROM entity_change_events
            WHERE entity_id = ${entityId} AND workspace_id = ${workspaceId}
              AND change_id > ${cursor}
            ORDER BY changed_at DESC
            LIMIT ${limit + 1}
          ` as EventRow[];
        } else {
          rows = await sql`
            SELECT change_id, entity_id, entity_type, change_type,
                   previous_value, new_value, source, changed_at
            FROM entity_change_events
            WHERE entity_id = ${entityId} AND workspace_id = ${workspaceId}
            ORDER BY changed_at DESC
            LIMIT ${limit + 1}
          ` as EventRow[];
        }
      } else {
        if (cursor) {
          rows = await sql`
            SELECT change_id, entity_id, entity_type, change_type,
                   previous_value, new_value, source, changed_at
            FROM entity_change_events
            WHERE workspace_id = ${workspaceId}
              AND change_id > ${cursor}
            ORDER BY changed_at DESC
            LIMIT ${limit + 1}
          ` as EventRow[];
        } else {
          rows = await sql`
            SELECT change_id, entity_id, entity_type, change_type,
                   previous_value, new_value, source, changed_at
            FROM entity_change_events
            WHERE workspace_id = ${workspaceId}
            ORDER BY changed_at DESC
            LIMIT ${limit + 1}
          ` as EventRow[];
        }
      }

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? page[page.length - 1]!.change_id : null;

      return c.json({
        data: page.map((r) => ({
          changeId: r.change_id,
          entityId: r.entity_id,
          entityType: r.entity_type,
          changeType: r.change_type,
          previousValue: r.previous_value,
          newValue: r.new_value,
          source: r.source,
          changedAt: r.changed_at,
        })),
        meta: { hasMore, nextCursor },
      });
    } catch {
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch events' } }, 500);
    }
  });

  return app;
}

function rowToSubscription(row: SubRow) {
  return {
    subscriptionId: row.subscription_id,
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    filters: row.filters,
    createdAt: row.created_at,
    active: row.active,
  };
}
