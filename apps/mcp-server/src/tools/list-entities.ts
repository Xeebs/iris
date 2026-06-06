import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compress } from '@iris/compression';
import type { VectorStore } from '@iris/semantic-core';
import type { ContextPermissions } from '@iris/semantic-core';
import { filterContextByRole } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';
import { assertWorkspace } from '../workspace-guard.js';

const log = logger.child({ tool: 'list-entities' });

const inputSchema = {
  entityType: z.string().min(1).describe('Entity type to list (e.g., contact, deal, company)'),
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .default(50)
    .describe('Maximum number of entities to return'),
  contextBudget: z
    .number()
    .int()
    .positive()
    .default(2000)
    .describe('Maximum tokens in the response'),
};

/**
 * Register the list-entities tool on an McpServer instance.
 *
 * @param server                   - MCP server to register on
 * @param vectorStore              - Initialized vector store
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 * @param contextPermissions       - Role-based access permissions, or null for unrestricted
 */
export function registerListEntities(
  server: McpServer,
  vectorStore: VectorStore,
  authenticatedWorkspaceId: string | null = null,
  contextPermissions: ContextPermissions | null = null,
): void {
  server.registerTool(
    'list-entities',
    {
      title: 'List Entities',
      description:
        'List entities of a given type within a workspace, ordered by most recently modified.',
      inputSchema,
    },
    async (params) => {
      try {
        const authError = assertWorkspace(params.workspaceId, authenticatedWorkspaceId);
        if (authError) return { content: [{ type: 'text' as const, text: authError }] };

        if (contextPermissions && !contextPermissions.allowedEntityTypes.has(params.entityType)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Access denied: entity type "${params.entityType}" is not permitted for this API key's role.`,
              },
            ],
          };
        }

        const entities = await vectorStore.listByType(
          params.workspaceId,
          params.entityType,
          params.limit ?? 50,
        );

        if (entities.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No entities of type "${params.entityType}" found in workspace ${params.workspaceId}.`,
              },
            ],
          };
        }

        const filtered = contextPermissions
          ? filterContextByRole(entities, contextPermissions)
          : entities;

        const compressed = compress(filtered, { contextBudget: params.contextBudget ?? 2000 });

        const text = compressed.truncated
          ? compressed.content + `\n\n[truncated: ${compressed.savedTokens} tokens saved]`
          : compressed.content;

        log.info('list-entities complete', {
          workspaceId: params.workspaceId,
          entityType: params.entityType,
          entityCount: compressed.entityCount,
          tokenCount: compressed.tokenCount,
          roleFiltered: !!contextPermissions,
        });

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        log.error('list-entities failed', { error: err });
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
