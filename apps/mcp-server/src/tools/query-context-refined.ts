import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type postgres from 'postgres';
import { QueryExpansionEngine } from '@iris/semantic-core/query-expansion-engine';
import { logger } from '@iris/core/logger';

const log = logger.child({ tool: 'query-context-refined' });

const FEEDBACK_MARKS = ['stale', 'incomplete', 'irrelevant', 'useful'] as const;

const inputSchema = {
  query: z.string().min(1).describe('The search query to expand'),
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
  stage: z.number().int().min(1).optional().describe('Expansion stage — 1 for initial, 2+ for iterative refinement'),
  sessionId: z.string().uuid().optional().describe('Prior expansion session ID to continue'),
  feedback: z.array(z.object({
    entityId: z.string().min(1),
    mark: z.enum(FEEDBACK_MARKS),
  })).optional().describe('Feedback marks from previous round to guide re-ranking'),
  contextBudget: z.number().int().min(100).max(8000).optional().describe('Maximum tokens in response (default: 2000)'),
};

/**
 * Register the query-context-refined tool on an McpServer instance.
 *
 * @param server - MCP server to register on
 * @param sql - Postgres client for expansion session persistence
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 */
export function registerQueryContextRefined(
  server: McpServer,
  sql: ReturnType<typeof postgres>,
  authenticatedWorkspaceId: string | null = null,
): void {
  const engine = new QueryExpansionEngine(sql);

  server.registerTool(
    'query-context-refined',
    {
      title: 'Query Context (Refined)',
      description: 'Iteratively expand and refine search results using user feedback marks. Supports multi-stage retrieval where each round re-ranks results based on stale/incomplete/irrelevant/useful signals.',
      inputSchema,
    },
    async (params) => {
      const budget = params.contextBudget ?? 2000;
      const stage = params.stage ?? 1;
      const feedback = params.feedback ?? null;

      try {
        const result = await engine.expandQuery(params.query, stage, feedback && feedback.length > 0 ? feedback : null);
        if (result.isErr()) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.message }) }] };
        }

        const session = result.value;
        const topResults = session.results.slice(0, Math.min(10, Math.floor(budget / 150)));
        const output = {
          sessionId: session.sessionId,
          query: session.query,
          stage: session.stage,
          results: topResults,
          directions: session.directions.slice(0, 3),
          truncated: session.results.length > topResults.length,
        };

        log.info('query-context-refined executed', {
          sessionId: session.sessionId,
          resultCount: topResults.length,
          stage,
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('query-context-refined failed', { error: msg });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }] };
      }
    },
  );
}
