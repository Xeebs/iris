import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '@iris/core/logger';

import { registerTool } from '../register-tool.js';

const log = logger.child({ tool: 'query-federated-context' });

const inputSchema = {
  query: z.string().min(1).describe('Natural language query across federated workspaces'),
  workspaceId: z.string().min(1).optional().describe('Source workspace ID (defaults to the authenticated key\'s workspace)'),
  federatedWorkspaceIds: z.array(z.string().min(1)).min(1).max(10).describe('Target workspace IDs to query'),
  maxTokenBudget: z.number().int().positive().default(2000).describe('Maximum tokens for merged result'),
};

type ToolInput = z.infer<z.ZodObject<typeof inputSchema>> & { workspaceId: string };

/**
 * Register the query-federated-context MCP tool.
 * @param server - MCP server instance
 * @param deps - External dependencies (sql, etc.)
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 */
export function registerQueryFederatedContextTool(
  server: McpServer,
  deps: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]> },
  authenticatedWorkspaceId: string | null = null,
): void {
  registerTool(
    server,
    'query-federated-context',
    {
      description: 'Query entities and context from federated (cross-tenant) workspaces with permission enforcement',
      inputSchema,
      authenticatedWorkspaceId,
    },
    async (rawInput) => {
      const { query, workspaceId, federatedWorkspaceIds, maxTokenBudget } = rawInput as ToolInput;
      try {
        const { queryFederatedContext, mergeFederatedResults } = await import('@iris/semantic-core/federation-manager');

        log.info('Federated context query', { workspaceId, federatedWorkspaceIds, query: query.slice(0, 80) });

        const result = await queryFederatedContext(deps.sql, query, workspaceId, federatedWorkspaceIds, maxTokenBudget);

        if (result.isErr()) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: result.error.message, truncated: false }),
            }],
          };
        }

        const merged = mergeFederatedResults([result.value.entities], maxTokenBudget);

        const output = {
          entities: merged.entities,
          queriedWorkspaces: result.value.queriedWorkspaces,
          permissionDenied: result.value.permissionDenied,
          totalTokensEstimate: merged.tokenCount,
          truncated: merged.truncated,
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(output),
          }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('query-federated-context failed', { error: msg });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: msg, truncated: false }),
          }],
        };
      }
    },
  );
}
