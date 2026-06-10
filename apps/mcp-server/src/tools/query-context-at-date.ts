import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '@iris/core/logger';

import { registerTool } from '../register-tool.js';

const log = logger.child({ tool: 'query-context-at-date' });

const inputSchema = {
  query: z.string().min(1).describe('Natural language query'),
  workspaceId: z.string().min(1).describe('Workspace ID'),
  targetDate: z.string().datetime().describe('ISO 8601 date — query context as it existed at this point in time'),
  contextBudget: z.number().int().positive().default(2000).describe('Maximum tokens to return'),
};

type ToolInput = z.infer<z.ZodObject<typeof inputSchema>>;

/**
 * Register the query-context-at-date MCP tool.
 * @param server - MCP server instance
 * @param deps - External dependencies
 */
export function registerQueryContextAtDateTool(
  server: McpServer,
  deps: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]> },
): void {
  registerTool(
    server,
    'query-context-at-date',
    {
      description: 'Query business context as it existed at a specific historical point in time using time-travel snapshots',
      inputSchema,
    },
    async (rawInput) => {
      const { query, workspaceId, targetDate, contextBudget } = rawInput as ToolInput;
      try {
        const { queryAsOfDate } = await import('@iris/semantic-core/context-versioner');

        log.info('Historical context query', { workspaceId, targetDate, query: query.slice(0, 80) });

        const result = await queryAsOfDate(deps.sql, workspaceId, query, new Date(targetDate), contextBudget);

        if (result.isErr()) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.message }) }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.value) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('query-context-at-date failed', { error: msg });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }] };
      }
    },
  );
}
