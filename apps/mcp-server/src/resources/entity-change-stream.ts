import { z } from 'zod';
import type { Sql } from 'postgres';
import { EntityChangeStreamManager } from '@iris/semantic-core/entity-change-stream';
import { logger } from '@iris/core/logger';

const InputSchema = z.object({
  entityId: z.string().min(1).describe('Entity ID to fetch recent changes for'),
  workspaceId: z.string().min(1).describe('Workspace scope'),
  sinceMinutes: z.number().int().positive().default(60).describe('Look back window in minutes'),
  limit: z.number().int().positive().max(50).default(20).describe('Maximum changes to return'),
});

export type EntityChangeStreamResourceInput = z.infer<typeof InputSchema>;

/**
 * MCP resource that provides recent entity change history to Claude agents.
 * @param sql - Postgres client
 * @returns MCP resource definition
 */
export function createEntityChangeStreamResource(sql: Sql) {
  const manager = new EntityChangeStreamManager(sql);

  return {
    name: 'entities/:id/change-stream',
    description:
      'Provides recent change events for a specific entity — useful for understanding what changed, when, and from which connector.',
    mimeType: 'application/json',
    inputSchema: InputSchema,
    handler: async (input: EntityChangeStreamResourceInput) => {
      const parsed = InputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          contents: [{
            uri: `entities/${input.entityId}/change-stream`,
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'Invalid input', details: parsed.error.flatten() }),
          }],
        };
      }

      try {
        const since = new Date(Date.now() - parsed.data.sinceMinutes * 60 * 1000);
        const changes = await manager.replayChanges(
          parsed.data.entityId,
          parsed.data.workspaceId,
          since,
          parsed.data.limit
        );

        const notifications = changes.map((c) => ({
          changeId: c.changeId,
          changeType: c.changeType,
          source: c.source,
          changedAt: c.changedAt,
          summary: manager.createChangeNotification(c),
        }));

        logger.debug('MCP entity-change-stream resource fetched', {
          entityId: parsed.data.entityId,
          changeCount: changes.length,
        });

        return {
          contents: [{
            uri: `entities/${parsed.data.entityId}/change-stream`,
            mimeType: 'application/json',
            text: JSON.stringify({
              entityId: parsed.data.entityId,
              totalChanges: changes.length,
              sinceMinutes: parsed.data.sinceMinutes,
              changes: notifications,
            }),
          }],
        };
      } catch (e) {
        logger.error('MCP entity-change-stream resource failed', { error: e });
        return {
          contents: [{
            uri: `entities/${input.entityId}/change-stream`,
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'Failed to fetch change stream', details: String(e) }),
          }],
        };
      }
    },
  };
}
