import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const inputSchema = {
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
  filter: z
    .string()
    .optional()
    .describe('Optional substring filter for term names'),
};

/**
 * Register the list-glossary tool on an McpServer instance.
 * Glossary service is not yet implemented — returns a structured placeholder.
 *
 * @param server - MCP server to register on
 */
export function registerListGlossary(server: McpServer): void {
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
    },
  );
}
