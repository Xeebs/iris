import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateSuggestions } from '@iris/semantic-core/proactive-suggester';
import { logger } from '@iris/core/logger';

import { registerTool } from './register-tool.js';

const log = logger.child({ tool: 'suggest-context' });

const inputSchema = {
  workspaceId: z.string().min(1).optional().describe('Workspace ID for tenant isolation (defaults to the authenticated key\'s workspace)'),
  recentQueries: z
    .array(z.string())
    .max(20)
    .default([])
    .describe('Recent queries from this session to personalise suggestions'),
  userRole: z.string().optional().describe('User role for role-affinity suggestions'),
  maxSuggestions: z
    .number()
    .int()
    .positive()
    .max(5)
    .default(3)
    .describe('Maximum number of suggestions to return'),
};

/**
 * Register the suggest-context tool on an McpServer instance.
 * Returns proactive context suggestions based on recent query activity.
 *
 * @param server                   - MCP server to register on
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 */
export function registerSuggestContext(
  server: McpServer,
  authenticatedWorkspaceId: string | null = null,
): void {
  registerTool(
    server,
    'suggest-context',
    {
      title: 'Suggest Context',
      description:
        'Get proactive context suggestions based on recent query activity. ' +
        'Returns top-N entity types and labels that are likely relevant to the current session.',
      inputSchema,
      authenticatedWorkspaceId,
    },
    async (rawParams) => {
      const params = rawParams as z.infer<z.ZodObject<typeof inputSchema>> & { workspaceId: string };
      try {
        const activity = (params.recentQueries ?? []).map((q: string) => ({
          query: q,
          timestamp: new Date(),
        }));

        const result = generateSuggestions(activity, params.userRole, params.maxSuggestions ?? 3);

        if (result.suggestions.length === 0) {
          return {
            content: [
              { type: 'text' as const, text: 'No context suggestions available for the current session.' },
            ],
          };
        }

        const lines = result.suggestions.map(
          (s, i) =>
            `${i + 1}. **${s.label}** (${s.entityType}) — ${s.reason} [confidence: ${Math.round(s.confidence * 100)}%]`,
        );

        const text = `Suggested context for your session:\n\n${lines.join('\n')}`;

        log.info('suggest-context complete', {
          workspaceId: params.workspaceId,
          count: result.suggestions.length,
        });

        return { content: [{ type: 'text' as const, text }] };
      } catch (e) {
        log.error('suggest-context failed', { error: e });
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
