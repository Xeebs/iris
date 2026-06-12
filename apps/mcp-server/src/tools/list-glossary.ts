import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GlossaryService } from '@iris/semantic-core';
import { withResponseCache } from '@iris/cache/response-cache';
import type { ResponseCache } from '@iris/cache/response-cache';

import { registerTool } from '../register-tool.js';

const MAX_PAGE_SIZE = 100;

const inputSchema = {
  workspaceId: z.string().min(1).optional().describe('Workspace ID for tenant isolation (defaults to the authenticated key\'s workspace)'),
  filter: z
    .string()
    .optional()
    .describe('Optional substring filter for term names'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(50)
    .describe(`Maximum number of terms per page (max ${MAX_PAGE_SIZE})`),
  cursor: z
    .string()
    .optional()
    .describe('Opaque pagination cursor from a previous response. Pass to retrieve the next page.'),
};

/**
 * Register the list-glossary tool on an McpServer instance.
 * @param server - MCP server to register on
 * @param glossaryService - GlossaryService instance
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 * @param responseCache - Optional response-level cache (1-hour TTL for glossary)
 */
export function registerListGlossary(
  server: McpServer,
  glossaryService: GlossaryService,
  authenticatedWorkspaceId: string | null = null,
  responseCache: ResponseCache | null = null,
): void {
  registerTool(
    server,
    'list-glossary',
    {
      title: 'List Glossary',
      description:
        'Return business terminology definitions for this workspace. ' +
        'Includes metric names, entity type descriptions, and domain-specific terms. ' +
        'Supports pagination via the `cursor` field — pass `nextCursor` from a previous response to get the next page.',
      inputSchema,
      authenticatedWorkspaceId,
    },
    async (rawParams) => {
      const params = rawParams as z.infer<z.ZodObject<typeof inputSchema>> & { workspaceId: string };

      const execute = async () => {
        const pageSize = Math.min(params.limit ?? 50, MAX_PAGE_SIZE);
        const result = await glossaryService.listTerms(
          params.workspaceId,
          params.filter,
          undefined,
          pageSize + 1,
          params.cursor,
        );

        if (result.isErr()) {
          return {
            content: [{ type: 'text' as const, text: `Error retrieving glossary: ${result.error.message}` }],
          };
        }

        const allTerms = result.value;
        const hasMore = allTerms.length > pageSize;
        const terms = hasMore ? allTerms.slice(0, pageSize) : allTerms;
        const lastTerm = terms[terms.length - 1];
        const nextCursor = hasMore ? lastTerm?.term : undefined;

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

        let formatted = terms
          .map((t) => `${t.term}: ${t.definition}${t.exampleValue ? ` (e.g. ${t.exampleValue})` : ''}`)
          .join('\n');

        if (nextCursor) {
          formatted += `\n\n[nextCursor: ${nextCursor}]`;
        }

        return {
          content: [{ type: 'text' as const, text: formatted }],
          ...(nextCursor ? { nextCursor } : {}),
        };
      };

      if (responseCache) {
        return withResponseCache('list-glossary', params.workspaceId, params as Record<string, unknown>, responseCache, execute);
      }
      return execute();
    },
  );
}
