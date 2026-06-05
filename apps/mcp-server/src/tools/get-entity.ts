import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeEntity } from '@iris/compression';
import type { VectorStore } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

const log = logger.child({ tool: 'get-entity' });

const inputSchema = {
  id: z.string().min(1).describe('Globally unique entity ID (e.g., hubspot:contact:123)'),
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
};

/**
 * Register the get-entity tool on an McpServer instance.
 *
 * @param server      - MCP server to register on
 * @param vectorStore - Initialized vector store
 */
export function registerGetEntity(server: McpServer, vectorStore: VectorStore): void {
  server.registerTool(
    'get-entity',
    {
      title: 'Get Entity',
      description: 'Retrieve a specific entity by its globally unique ID.',
      inputSchema,
    },
    async (params) => {
      try {
        const entity = await vectorStore.getById(params.workspaceId, params.id);

        if (!entity) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Entity "${params.id}" not found in workspace ${params.workspaceId}.`,
              },
            ],
          };
        }

        log.info('get-entity complete', { workspaceId: params.workspaceId, id: params.id });

        return { content: [{ type: 'text' as const, text: serializeEntity(entity) }] };
      } catch (err) {
        log.error('get-entity failed', { error: err, id: params.id });
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
