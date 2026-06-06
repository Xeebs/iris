import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SemanticCache } from '@iris/cache/semantic-cache';
import { compress } from '@iris/compression';
import type { VectorStore } from '@iris/semantic-core';
import { retrieveContext } from '@iris/semantic-core';
import type { ContextPermissions } from '@iris/semantic-core';
import { filterContextByRole } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';
import { assertWorkspace } from '../workspace-guard.js';

const log = logger.child({ tool: 'query-context' });

const inputSchema = {
  query: z.string().min(1).describe('Natural language query'),
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
  contextBudget: z
    .number()
    .int()
    .positive()
    .default(2000)
    .describe('Maximum tokens to return'),
  entityTypes: z
    .array(z.string())
    .optional()
    .describe('Filter to these entity types only'),
  topK: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(10)
    .describe('Maximum entities to retrieve before compression'),
};

/**
 * Register the query-context tool on an McpServer instance.
 *
 * @param server                   - MCP server to register on
 * @param vectorStore              - Initialized vector store for semantic search
 * @param cache                    - Semantic cache instance
 * @param openAiKey                - OpenAI API key for query embedding
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 * @param contextPermissions       - Role-based access permissions, or null for unrestricted
 */
export function registerQueryContext(
  server: McpServer,
  vectorStore: VectorStore,
  cache: SemanticCache,
  openAiKey: string,
  authenticatedWorkspaceId: string | null = null,
  contextPermissions: ContextPermissions | null = null,
): void {
  // @ts-ignore TS2589 — MCP SDK registerTool generics exceed TypeScript's depth limit for this 5-field schema
  server.registerTool(
    'query-context',
    {
      title: 'Query Context',
      description:
        'Retrieve semantically relevant business context for a natural language query. ' +
        'Returns compressed entity information within the token budget.',
      inputSchema,
    },
    async (params) => {
      const start = Date.now();
      try {
        const authError = assertWorkspace(params.workspaceId, authenticatedWorkspaceId);
        if (authError) return { content: [{ type: 'text' as const, text: authError }] };
        const queryEmbeddingPlaceholder: number[] = [];

        const cacheHit = queryEmbeddingPlaceholder.length > 0
          ? await cache.get(queryEmbeddingPlaceholder, params.workspaceId)
          : null;

        if (cacheHit) {
          log.info('Cache hit', { workspaceId: params.workspaceId, durationMs: Date.now() - start });
          return { content: [{ type: 'text' as const, text: cacheHit.response }] };
        }

        const retrievalOpts: Parameters<typeof retrieveContext>[2] = {
          workspaceId: params.workspaceId,
          topK: params.topK ?? 10,
          expandRelationships: true,
          maxDepth: 1,
          openAiApiKey: openAiKey,
        };
        if (params.entityTypes !== undefined) {
          retrievalOpts.entityTypes = params.entityTypes;
        }
        const result = await retrieveContext(params.query, vectorStore, retrievalOpts);

        const entities = contextPermissions
          ? filterContextByRole(result.entities, contextPermissions)
          : result.entities;

        const compressed = compress(entities, {
          contextBudget: params.contextBudget ?? 2000,
          query: params.query,
        });

        const text = compressed.truncated
          ? compressed.content + `\n\n[truncated: ${compressed.savedTokens} tokens saved]`
          : compressed.content;

        log.info('Query complete', {
          workspaceId: params.workspaceId,
          entityCount: compressed.entityCount,
          tokenCount: compressed.tokenCount,
          truncated: compressed.truncated,
          roleFiltered: !!contextPermissions,
          durationMs: Date.now() - start,
        });

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        log.error('query-context failed', { error: err, workspaceId: params.workspaceId });
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
