import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeEntity } from '@iris/compression';
import type { VectorStore } from '@iris/semantic-core';
import type { ContextPermissions } from '@iris/semantic-core';
import { filterContextByRole } from '@iris/semantic-core';
import type { WorkspacePiiConfig } from '@iris/semantic-core';
import { maskEntity } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

import { registerTool } from '../register-tool.js';

const log = logger.child({ tool: 'get-entity' });

const inputSchema = {
  id: z.string().min(1).describe('Globally unique entity ID (e.g., hubspot:contact:123)'),
  workspaceId: z.string().min(1).optional().describe('Workspace ID for tenant isolation (defaults to the authenticated key\'s workspace)'),
};

/**
 * Register the get-entity tool on an McpServer instance.
 *
 * @param server                   - MCP server to register on
 * @param vectorStore              - Initialized vector store
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 * @param contextPermissions       - Role-based access permissions, or null for unrestricted
 * @param piiConfig                - Workspace PII masking config, or null to skip masking
 */
export function registerGetEntity(
  server: McpServer,
  vectorStore: VectorStore,
  authenticatedWorkspaceId: string | null = null,
  contextPermissions: ContextPermissions | null = null,
  piiConfig: WorkspacePiiConfig | null = null,
): void {
  registerTool(
    server,
    'get-entity',
    {
      title: 'Get Entity',
      description: 'Retrieve a specific entity by its globally unique ID.',
      inputSchema,
      authenticatedWorkspaceId,
    },
    async (rawParams) => {
      const params = rawParams as z.infer<z.ZodObject<typeof inputSchema>> & { workspaceId: string };
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

        let finalEntity = entity;

        if (contextPermissions) {
          const [filtered] = filterContextByRole([entity], contextPermissions);
          if (!filtered) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Access denied: entity type "${entity.type}" is not permitted for this API key's role.`,
                },
              ],
            };
          }
          finalEntity = filtered;
        }

        if (piiConfig) {
          finalEntity = maskEntity(finalEntity, piiConfig);
        }

        log.info('get-entity complete', {
          workspaceId: params.workspaceId,
          id: params.id,
          roleFiltered: !!contextPermissions,
          piiMasked: !!piiConfig,
        });
        return { content: [{ type: 'text' as const, text: serializeEntity(finalEntity) }] };
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
