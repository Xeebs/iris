import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compress } from '@iris/compression';
import type { VectorStore } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

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
 * @param server      - MCP server to register on
 * @param vectorStore - Initialized vector store
 */
export function registerListEntities(server: McpServer, vectorStore: VectorStore): void {
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

        const compressed = compress(entities, { contextBudget: params.contextBudget ?? 2000 });

        const text = compressed.truncated
          ? compressed.content + `\n\n[truncated: ${compressed.savedTokens} tokens saved]`
          : compressed.content;

        log.info('list-entities complete', {
          workspaceId: params.workspaceId,
          entityType: params.entityType,
          entityCount: compressed.entityCount,
          tokenCount: compressed.tokenCount,
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
