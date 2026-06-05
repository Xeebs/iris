import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GlossaryService } from '@iris/semantic-core';
import { assertWorkspace } from '../workspace-guard.js';

const inputSchema = {
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
  filter: z
    .string()
    .optional()
    .describe('Optional substring filter for term names'),
};

/**
 * Register the list-glossary tool on an McpServer instance.
 * @param server - MCP server to register on
 * @param glossaryService - GlossaryService instance
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 */
export function registerListGlossary(
  server: McpServer,
  glossaryService: GlossaryService,
  authenticatedWorkspaceId: string | null = null,
): void {
  server.registerTool(
    'list-glossary',
    {
      title: 'List Glossary',
      description:
        'Return business terminology definitions for this workspace. ' +
        'Includes metric names, entity type descriptions, and domain-specific terms.',
      inputSchema,
    },
    async (params) => {
      const authError = assertWorkspace(params.workspaceId, authenticatedWorkspaceId);
      if (authError) {
        return { content: [{ type: 'text' as const, text: authError }] };
      }

      const result = await glossaryService.listTerms(params.workspaceId, params.filter);
      if (result.isErr()) {
        return {
          content: [{ type: 'text' as const, text: `Error retrieving glossary: ${result.error.message}` }],
        };
      }
      const terms = result.value;
      if (terms.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `No glossary terms are defined for workspace ${params.workspaceId}` +
                (params.filter ? ` matching "${params.filter}"` : '') +
                `. Configure glossary terms via the Iris dashboard.`,
            },
          ],
        };
      }
      const formatted = terms
        .map((t) => `${t.term}: ${t.definition}${t.exampleValue ? ` (e.g. ${t.exampleValue})` : ''}`)
        .join('\n');
      return {
        content: [{ type: 'text' as const, text: formatted }],
      };
    },
  );
}
