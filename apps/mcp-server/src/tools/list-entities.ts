import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compress } from '@iris/compression';
import type { VectorStore } from '@iris/semantic-core';
import type { ContextPermissions } from '@iris/semantic-core';
import { filterContextByRole } from '@iris/semantic-core';
import type { WorkspacePiiConfig } from '@iris/semantic-core';
import { maskEntities } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

import { registerTool } from '../register-tool.js';

const log = logger.child({ tool: 'list-entities' });

const MAX_PAGE_SIZE = 100;

const inputSchema = {
  entityType: z.string().min(1).describe('Entity type to list (e.g., contact, deal, company)'),
  workspaceId: z.string().min(1).optional().describe('Workspace ID for tenant isolation (defaults to the authenticated key\'s workspace)'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(50)
    .describe(`Maximum number of entities per page (max ${MAX_PAGE_SIZE})`),
  cursor: z
    .string()
    .optional()
    .describe('Opaque pagination cursor returned by a previous call. Pass to retrieve the next page.'),
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
 * @param piiConfig                - Workspace PII masking config, or null to skip masking
 */
export function registerListEntities(
  server: McpServer,
  vectorStore: VectorStore,
  authenticatedWorkspaceId: string | null = null,
  contextPermissions: ContextPermissions | null = null,
  piiConfig: WorkspacePiiConfig | null = null,
): void {
  registerTool(
    server,
    'list-entities',
    {
      title: 'List Entities',
      description:
        'List entities of a given type within a workspace, ordered by most recently modified. ' +
        'Supports pagination via the `cursor` field — pass `nextCursor` from a previous response to get the next page.',
      inputSchema,
      authenticatedWorkspaceId,
    },
    async (rawParams) => {
      const params = rawParams as z.infer<z.ZodObject<typeof inputSchema>> & { workspaceId: string };
      try {
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

        const pageSize = Math.min(params.limit ?? 50, MAX_PAGE_SIZE);
        const entities = await vectorStore.listByType(
          params.workspaceId,
          params.entityType,
          pageSize + 1,
          params.cursor,
        );

        const hasMore = entities.length > pageSize;
        const page = hasMore ? entities.slice(0, pageSize) : entities;
        const lastEntity = page[page.length - 1];
        const nextCursor = hasMore && lastEntity?.lastModified
          ? (lastEntity.lastModified instanceof Date
              ? lastEntity.lastModified.toISOString()
              : String(lastEntity.lastModified))
          : undefined;

        if (page.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No entities of type "${params.entityType}" found in workspace ${params.workspaceId}.`,
              },
            ],
          };
        }

        const roleFiltered = contextPermissions
          ? filterContextByRole(page, contextPermissions)
          : page;

        const masked = piiConfig ? maskEntities(roleFiltered, piiConfig) : roleFiltered;

        const compressed = compress(masked, { contextBudget: params.contextBudget ?? 2000 });

        let text = compressed.truncated
          ? compressed.content + `\n\n[truncated: ${compressed.savedTokens} tokens saved]`
          : compressed.content;

        if (nextCursor) {
          text += `\n\n[nextCursor: ${nextCursor}]`;
        }

        log.info('list-entities complete', {
          workspaceId: params.workspaceId,
          entityType: params.entityType,
          entityCount: compressed.entityCount,
          tokenCount: compressed.tokenCount,
          hasMore,
          roleFiltered: !!contextPermissions,
          piiMasked: !!piiConfig,
        });

        return {
          content: [{ type: 'text' as const, text }],
          ...(nextCursor ? { nextCursor } : {}),
        };
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
