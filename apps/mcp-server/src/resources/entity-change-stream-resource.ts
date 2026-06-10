import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Sql } from 'postgres';

import { registerTool } from '../register-tool.js';
import { EntityChangeStreamManager } from '@iris/semantic-core/entity-change-stream';
import type { ChangeType, EntityChange } from '@iris/semantic-core/entity-change-stream';
import { logger } from '@iris/core/logger';

const RESOURCE_URI_PREFIX = 'iris://entities/';
const MAX_EVENTS_IN_RESPONSE = 50;

/**
 * Registers the entity change stream as an MCP resource.
 * Resource URI: iris://entities/{entityId}/changes
 * Supports filter query params embedded in URI: ?types=created,updated&fields=email&since=ISO8601
 *
 * @param server - McpServer instance
 * @param sql - Postgres sql instance
 * @param authenticatedWorkspaceId - Workspace scope
 */
export function registerChangeStreamResource(
  server: McpServer,
  sql: Sql,
  authenticatedWorkspaceId: string | null,
): void {
  const manager = new EntityChangeStreamManager(sql);

  server.resource(
    'entity-changes',
    `${RESOURCE_URI_PREFIX}*`,
    async (uri) => {
      const uriStr = uri.href;
      // Strip query string before path parsing so segment check is clean
      const pathOnly = uriStr.split('?')[0]!;
      const path = pathOnly.replace(RESOURCE_URI_PREFIX, '');
      const [entityIdPart, ...rest] = path.split('/');
      const entityId = entityIdPart ?? null;

      if (!entityId || rest[0] !== 'changes') {
        return {
          contents: [{
            uri: uriStr,
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'Invalid resource URI. Expected: iris://entities/{entityId}/changes' }),
          }],
        };
      }

      // Parse query params from URI if present
      let sinceDate: Date | undefined;
      let filterTypes: ChangeType[] | undefined;
      let filterFields: string[] | undefined;
      let contextBudget = 2000;

      const qIdx = uriStr.indexOf('?');
      if (qIdx !== -1) {
        const qs = new URLSearchParams(uriStr.slice(qIdx + 1));
        const since = qs.get('since');
        if (since) sinceDate = new Date(since);
        const types = qs.get('types');
        if (types) filterTypes = types.split(',') as ChangeType[];
        const fields = qs.get('fields');
        if (fields) filterFields = fields.split(',');
        const budget = qs.get('budget');
        if (budget) contextBudget = parseInt(budget, 10);
      }

      const workspaceId = authenticatedWorkspaceId ?? 'unknown';
      const events = await fetchEntityChanges(sql, entityId, workspaceId, {
        ...(sinceDate !== undefined ? { sinceDate } : {}),
        ...(filterTypes !== undefined ? { changeTypes: filterTypes } : {}),
        ...(filterFields !== undefined ? { fields: filterFields } : {}),
        limit: MAX_EVENTS_IN_RESPONSE,
      });

      const serialized = serializeChangeEvents(events, filterFields, contextBudget);

      logger.debug('Entity change stream resource fetched', {
        entityId,
        workspaceId,
        eventCount: events.length,
        truncated: serialized.truncated,
      });

      return {
        contents: [{
          uri: uriStr,
          mimeType: 'application/json',
          text: JSON.stringify({
            entityId,
            workspaceId,
            eventCount: serialized.events.length,
            truncated: serialized.truncated,
            events: serialized.events,
          }, null, 2),
        }],
      };
    }
  );

  // Register subscription tool alongside resource
  registerTool(
    server,
    'subscribe-entity-changes',
    {
      description: 'Subscribe to real-time change events for an entity. Returns a subscriptionId for tracking.',
      inputSchema: {
        entityId: z.string().describe('Entity ID to monitor (or "*" for all entities in workspace)'),
        workspaceId: z.string().optional(),
        entityTypes: z.array(z.string()).optional(),
        changeTypes: z.array(z.string()).optional(),
      },
    },
    async (input) => {
      const { entityId, workspaceId, entityTypes, changeTypes } = input as {
        entityId: string;
        workspaceId?: string;
        entityTypes?: string[];
        changeTypes?: string[];
      };

      const wsId = authenticatedWorkspaceId ?? workspaceId ?? '';
      if (!wsId) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'workspaceId is required' }) }] };
      }

      try {
        const subscription = await manager.subscribeToEntityChanges(
          wsId,
          entityId === '*' ? null : entityId,
          {
            ...(entityTypes !== undefined ? { entityTypes } : {}),
            ...(changeTypes !== undefined ? { changeTypes: changeTypes as ChangeType[] } : {}),
          }
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              subscriptionId: subscription.subscriptionId,
              entityId: subscription.entityId,
              workspaceId: subscription.workspaceId,
              active: subscription.active,
              resourceUri: `${RESOURCE_URI_PREFIX}${entityId}/changes`,
            }),
          }],
        };
      } catch (err) {
        logger.error('Failed to create entity change subscription', { error: err });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to create subscription' }) }] };
      }
    }
  );
}

type FetchOptions = {
  sinceDate?: Date;
  changeTypes?: ChangeType[];
  fields?: string[];
  limit: number;
};

async function fetchEntityChanges(
  sql: Sql,
  entityId: string,
  workspaceId: string,
  options: FetchOptions,
): Promise<EntityChange[]> {
  const { sinceDate, changeTypes, limit } = options;

  try {
    let rows: Array<{
      change_id: string;
      entity_id: string;
      entity_type: string;
      change_type: ChangeType;
      previous_value: Record<string, unknown> | null;
      new_value: Record<string, unknown> | null;
      source: string;
      workspace_id: string;
      changed_at: Date;
    }>;

    if (changeTypes && changeTypes.length > 0 && sinceDate) {
      rows = await sql`
        SELECT change_id, entity_id, entity_type, change_type,
               previous_value, new_value, source, workspace_id, changed_at
        FROM entity_change_events
        WHERE entity_id = ${entityId}
          AND workspace_id = ${workspaceId}
          AND change_type = ANY(${changeTypes as string[]})
          AND changed_at > ${sinceDate}
        ORDER BY changed_at DESC
        LIMIT ${limit}
      ` as typeof rows;
    } else if (changeTypes && changeTypes.length > 0) {
      rows = await sql`
        SELECT change_id, entity_id, entity_type, change_type,
               previous_value, new_value, source, workspace_id, changed_at
        FROM entity_change_events
        WHERE entity_id = ${entityId}
          AND workspace_id = ${workspaceId}
          AND change_type = ANY(${changeTypes as string[]})
        ORDER BY changed_at DESC
        LIMIT ${limit}
      ` as typeof rows;
    } else if (sinceDate) {
      rows = await sql`
        SELECT change_id, entity_id, entity_type, change_type,
               previous_value, new_value, source, workspace_id, changed_at
        FROM entity_change_events
        WHERE entity_id = ${entityId}
          AND workspace_id = ${workspaceId}
          AND changed_at > ${sinceDate}
        ORDER BY changed_at DESC
        LIMIT ${limit}
      ` as typeof rows;
    } else {
      rows = await sql`
        SELECT change_id, entity_id, entity_type, change_type,
               previous_value, new_value, source, workspace_id, changed_at
        FROM entity_change_events
        WHERE entity_id = ${entityId}
          AND workspace_id = ${workspaceId}
        ORDER BY changed_at DESC
        LIMIT ${limit}
      ` as typeof rows;
    }

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
  } catch {
    return [];
  }
}

function serializeChangeEvents(
  events: EntityChange[],
  fields: string[] | undefined,
  contextBudget: number,
): { events: unknown[]; truncated: boolean } {
  const TOKENS_PER_EVENT = 60;
  const maxEvents = Math.floor(contextBudget / TOKENS_PER_EVENT);

  const truncated = events.length > maxEvents;
  const sliced = truncated ? events.slice(0, maxEvents) : events;

  const serialized = sliced.map((e) => {
    const base = {
      changeId: e.changeId,
      changeType: e.changeType,
      changedAt: e.changedAt,
    };

    if (fields && fields.length > 0) {
      const newValueFiltered: Record<string, unknown> = {};
      const prevValueFiltered: Record<string, unknown> = {};
      for (const f of fields) {
        if (e.newValue?.[f] !== undefined) newValueFiltered[f] = e.newValue[f];
        if (e.previousValue?.[f] !== undefined) prevValueFiltered[f] = e.previousValue[f];
      }
      return { ...base, newValue: newValueFiltered, previousValue: prevValueFiltered };
    }

    return { ...base, newValue: e.newValue, previousValue: e.previousValue, source: e.source };
  });

  return { events: serialized, truncated };
}
