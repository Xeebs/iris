import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VectorStore } from '@iris/semantic-core';
import { retrieveContext } from '@iris/semantic-core';
import {
  parseAdvancedQuery,
  applyFilters,
  executeAggregation,
  formatAggregationResult,
  chainQueries,
} from '@iris/semantic-core/advanced-query-engine';
import { compress } from '@iris/compression';
import { logger } from '@iris/core/logger';
import { assertWorkspace } from '../workspace-guard.js';

const log = logger.child({ tool: 'advanced-query-context' });

const filterConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['=', '!=', '>', '<', '>=', '<=', 'contains', 'startsWith']),
  value: z.union([z.string(), z.number()]),
});

const aggregationSpecSchema = z.object({
  op: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  field: z.string().optional(),
  groupBy: z.string().optional(),
});

const inputSchema = {
  query: z.string().min(1).describe(
    'Natural language query or filter expression (e.g. "contacts where industry=\'SaaS\' and ARR>100k")',
  ),
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
  filters: z
    .array(filterConditionSchema)
    .optional()
    .describe('Explicit filter conditions to apply to retrieved entities'),
  aggregate: aggregationSpecSchema.optional().describe(
    'Aggregation to compute over filtered entities (count, sum, avg, min, max)',
  ),
  chainedQuery: z.string().optional().describe(
    'Optional follow-up query to execute with first results as context (multi-step query)',
  ),
  contextBudget: z
    .number()
    .int()
    .positive()
    .default(2000)
    .describe('Maximum tokens to return (applies when not aggregating)'),
  topK: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe('Maximum entities to retrieve before filtering/aggregating'),
};

/**
 * Register the advanced-query-context tool on an McpServer instance.
 *
 * @param server                   - MCP server to register on
 * @param vectorStore              - Initialized vector store for semantic search
 * @param openAiKey                - OpenAI API key for query embedding
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 */
export function registerAdvancedQueryContext(
  server: McpServer,
  vectorStore: VectorStore,
  openAiKey: string,
  authenticatedWorkspaceId: string | null = null,
): void {
  // @ts-ignore TS2589 — MCP SDK generics depth limit for multi-field schema
  server.registerTool(
    'advanced-query-context',
    {
      title: 'Advanced Query Context',
      description:
        'Advanced entity retrieval with filter expressions, aggregations, and multi-step chained queries. ' +
        'Supports syntax like "contacts where industry=\'SaaS\' and ARR>100k", ' +
        'aggregations like "sum revenue by region", and chained multi-step queries.',
      inputSchema,
    },
    async (params) => {
      const start = Date.now();
      try {
        const authError = assertWorkspace(params.workspaceId, authenticatedWorkspaceId);
        if (authError) return { content: [{ type: 'text' as const, text: authError }] };

        const topK = params.topK ?? 20;
        const contextBudget = params.contextBudget ?? 2000;

        if (params.chainedQuery) {
          const chainedResult = await chainQueries(
            params.query,
            params.chainedQuery,
            vectorStore,
            params.workspaceId,
            openAiKey,
            topK,
          );

          const compressed = compress(chainedResult.combined, {
            contextBudget,
            query: params.query,
          });

          const summary = [
            `Step 1 "${params.query}": ${chainedResult.firstQueryEntities.length} entities`,
            `Step 2 "${params.chainedQuery}": ${chainedResult.chainedEntities.length} entities`,
            `Combined: ${chainedResult.combined.length} unique entities`,
            '',
            compressed.content,
          ].join('\n');

          log.info('Advanced chained query complete', {
            workspaceId: params.workspaceId,
            durationMs: Date.now() - start,
            combined: chainedResult.combined.length,
          });

          return { content: [{ type: 'text' as const, text: summary }] };
        }

        const parsedQuery = parseAdvancedQuery(params.query);
        const entityTypes = parsedQuery.entityType ? [parsedQuery.entityType] : undefined;
        const combinedFilters = [
          ...parsedQuery.filters,
          ...(params.filters ?? []),
        ];

        const retrieval = await retrieveContext(params.query, vectorStore, {
          workspaceId: params.workspaceId,
          topK,
          expandRelationships: false,
          maxDepth: 0,
          openAiApiKey: openAiKey,
          ...(entityTypes ? { entityTypes } : {}),
        });

        const filtered = combinedFilters.length > 0
          ? applyFilters(retrieval.entities, combinedFilters)
          : retrieval.entities;

        if (params.aggregate) {
          const aggResult = executeAggregation(filtered, params.aggregate);
          const text = formatAggregationResult(aggResult, params.query);

          log.info('Advanced aggregation query complete', {
            workspaceId: params.workspaceId,
            op: params.aggregate.op,
            field: params.aggregate.field,
            groups: aggResult.groups.length,
            durationMs: Date.now() - start,
          });

          return { content: [{ type: 'text' as const, text }] };
        }

        const compressed = compress(filtered, {
          contextBudget,
          query: params.query,
        });

        const filterSummary = combinedFilters.length > 0
          ? ` (${combinedFilters.length} filter${combinedFilters.length > 1 ? 's' : ''} applied, ${filtered.length}/${retrieval.entities.length} entities matched)`
          : '';

        const text = compressed.truncated
          ? compressed.content + `\n\n[truncated${filterSummary}: ${compressed.savedTokens} tokens saved]`
          : compressed.content + (filterSummary ? `\n\n[${filterSummary.trim()}]` : '');

        log.info('Advanced filter query complete', {
          workspaceId: params.workspaceId,
          entityCount: filtered.length,
          filtersApplied: combinedFilters.length,
          durationMs: Date.now() - start,
        });

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        log.error('advanced-query-context failed', { error: err, workspaceId: params.workspaceId });
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
