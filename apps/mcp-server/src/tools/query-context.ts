import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SemanticCache } from '@iris/cache/semantic-cache';
import { compress } from '@iris/compression';
import type { VectorStore } from '@iris/semantic-core';
import { retrieveContext } from '@iris/semantic-core';
import type { ContextPermissions } from '@iris/semantic-core';
import { filterContextByRole } from '@iris/semantic-core';
import type { WorkspacePiiConfig } from '@iris/semantic-core';
import { maskEntities } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

import { registerTool } from '../register-tool.js';

const log = logger.child({ tool: 'query-context' });

const inputSchema = {
  query: z.string().min(1).describe('Natural language query'),
  workspaceId: z.string().min(1).optional().describe('Workspace ID for tenant isolation (defaults to the authenticated key\'s workspace)'),
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
    .default(20)
    .describe('Maximum entities to retrieve before compression'),
  expansionLevel: z
    .enum(['summary', 'detailed', 'full'])
    .optional()
    .describe('Progressive expansion level: summary (compact), detailed (with attributes), full (with relationships)'),
  fieldFilter: z
    .array(z.string())
    .optional()
    .describe('Only include these attribute field names in entity representations'),
  sessionId: z
    .string()
    .optional()
    .describe('Existing session ID for continued expansion (returned from a previous call)'),
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
 * @param piiConfig                - Workspace PII masking config, or null to skip masking
 */
export function registerQueryContext(
  server: McpServer,
  vectorStore: VectorStore,
  cache: SemanticCache,
  openAiKey: string,
  authenticatedWorkspaceId: string | null = null,
  contextPermissions: ContextPermissions | null = null,
  piiConfig: WorkspacePiiConfig | null = null,
): void {
  registerTool(
    server,
    'query-context',
    {
      title: 'Query Context',
      description:
        'Retrieve semantically relevant business context for a natural language query. ' +
        'Returns compressed entity information within the token budget.',
      inputSchema,
      authenticatedWorkspaceId,
    },
    async (rawParams) => {
      const params = rawParams as z.infer<z.ZodObject<typeof inputSchema>> & { workspaceId: string };
      const start = Date.now();
      try {
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

        const roleFiltered = contextPermissions
          ? filterContextByRole(result.entities, contextPermissions)
          : result.entities;

        const entities = piiConfig ? maskEntities(roleFiltered, piiConfig) : roleFiltered;

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
          piiMasked: !!piiConfig,
          durationMs: Date.now() - start,
        });

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        // Spell out Error fields — a raw Error under a non-`err` pino key
        // serializes to only its enumerable props (e.g. `{code}` for
        // postgres.js errors), hiding message/stack. postgres.js also attaches
        // non-enumerable `query`/`parameters` to build-time failures.
        const e = err as Partial<Error> & { code?: unknown; query?: unknown };
        log.error('query-context failed', {
          errorName: e.name,
          errorMessage: e.message,
          errorCode: typeof e.code === 'string' ? e.code : undefined,
          errorStack: e.stack,
          failedQuery: typeof e.query === 'string' ? e.query.slice(0, 500) : undefined,
          workspaceId: params.workspaceId,
        });
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
