import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compress } from '@iris/compression';
import type { VectorStore } from '@iris/semantic-core';
import { retrieveContext } from '@iris/semantic-core';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { registerTool } from '../register-tool.js';

const log = logger.child({ tool: 'streaming-context' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExpansionLevel = 'summary' | 'detailed' | 'full';

export interface ExpansionEntry {
  workspaceId: string;
  query: string;
  entities: SemanticEntity[];
  createdAt: number;
}

// In-process store: expansionKey → pending expansion data.
// Expires entries after 5 minutes to avoid memory growth.
const EXPANSION_STORE = new Map<string, ExpansionEntry>();
const EXPANSION_TTL_MS = 5 * 60 * 1000;

export function getExpansionStore(): Map<string, ExpansionEntry> {
  return EXPANSION_STORE;
}

/** Purge expired expansion entries. */
function pruneExpansions(): void {
  const now = Date.now();
  for (const [key, entry] of EXPANSION_STORE) {
    if (now - entry.createdAt > EXPANSION_TTL_MS) {
      EXPANSION_STORE.delete(key);
    }
  }
}

function generateExpansionKey(): string {
  return Math.random().toString(36).slice(2, 14);
}

// ---------------------------------------------------------------------------
// Context serialization per expansion level
// ---------------------------------------------------------------------------

/**
 * Render entities at the requested expansion level.
 * summary: label only; detailed: label + attributes; full: label + attrs + relationships
 *
 * @param entities - Entities to render
 * @param level - Expansion depth
 * @param budget - Token budget (approximated as character count / 4)
 */
export function renderAtLevel(
  entities: SemanticEntity[],
  level: ExpansionLevel,
  budget: number,
): { content: string; truncated: boolean; tokenEstimate: number } {
  const charBudget = budget * 4; // rough chars-per-token
  let output = '';
  let truncated = false;

  for (const entity of entities) {
    let block = '';

    if (level === 'summary') {
      block = `[${entity.type}] ${entity.label}\n`;
    } else if (level === 'detailed') {
      const attrs = Object.entries(entity.attributes ?? {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n');
      block = `[${entity.type}] ${entity.label}\n${attrs}\n\n`;
    } else {
      // full
      const attrs = Object.entries(entity.attributes ?? {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n');
      const rels = (entity.relationships ?? [])
        .map((r) => `  → ${r.type}: ${r.targetId}`)
        .join('\n');
      block = `[${entity.type}] ${entity.label}\n${attrs}\n${rels ? 'Relationships:\n' + rels : ''}\n\n`;
    }

    if (output.length + block.length > charBudget) {
      truncated = true;
      break;
    }
    output += block;
  }

  return {
    content: output.trimEnd(),
    truncated,
    tokenEstimate: Math.ceil(output.length / 4),
  };
}

/**
 * Predict which expansion level the client will need based on query and entity type.
 * Returns 'summary' for broad list queries, 'detailed' for specific entity queries.
 *
 * @param query - User's natural language query
 * @param entityTypes - Entity types in the result
 */
export function predictExpansionLevel(
  query: string,
  entityTypes: string[],
): ExpansionLevel {
  const lower = query.toLowerCase();

  // Detailed/full signal words
  if (
    lower.includes('detail') ||
    lower.includes('full') ||
    lower.includes('all attribute') ||
    lower.includes('relationship') ||
    lower.includes('connected to') ||
    lower.includes('related to')
  ) {
    return 'full';
  }

  // Summary signal: "list", "how many", "count", "show me"
  if (
    lower.includes('list') ||
    lower.includes('how many') ||
    lower.includes('count') ||
    lower.includes('show me all')
  ) {
    return 'summary';
  }

  // Metric entities are usually summary-level
  if (entityTypes.every((t) => t === 'metric' || t === 'kpi')) return 'summary';

  return 'detailed';
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const streamingInputSchema = {
  query: z.string().min(1).describe('Natural language query'),
  workspaceId: z.string().min(1).optional().describe('Workspace ID (defaults to the authenticated key\'s workspace)'),
  initialBudget: z
    .number()
    .int()
    .positive()
    .default(500)
    .describe('Token budget for the initial (compressed) response'),
  maxBudget: z
    .number()
    .int()
    .positive()
    .default(2000)
    .describe('Maximum token budget if expansion is requested'),
  expansionLevel: z
    .enum(['summary', 'detailed', 'full'])
    .optional()
    .describe('Initial expansion depth. If omitted, auto-predicted from query.'),
  entityTypes: z.array(z.string()).optional(),
  topK: z.number().int().positive().max(50).default(10),
};

const expansionInputSchema = {
  expansionKey: z.string().min(1).describe('Key returned by streaming-context'),
  workspaceId: z.string().min(1).optional().describe('Workspace ID (defaults to the authenticated key\'s workspace)'),
  targetLevel: z
    .enum(['detailed', 'full'])
    .describe('The expansion level to fetch next'),
  additionalBudget: z
    .number()
    .int()
    .positive()
    .default(1500)
    .describe('Additional token budget for the expanded response'),
};

/**
 * Register the streaming-context and get-context-expansion tools.
 *
 * @param server - MCP server to register on
 * @param vectorStore - Initialized vector store for semantic search
 * @param openAiKey - OpenAI API key for query embedding
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 */
export function registerStreamingContext(
  server: McpServer,
  vectorStore: VectorStore,
  openAiKey: string,
  authenticatedWorkspaceId: string | null = null,
): void {
  // Tool 1: streaming-context — returns initial summary and an expansionKey
  registerTool(
    server,
    'streaming-context',
    {
      title: 'Streaming Context',
      description:
        'Returns a compressed initial context for a query at summary level, plus an expansionKey. ' +
        'Call get-context-expansion with that key to fetch a more detailed view if needed.',
      inputSchema: streamingInputSchema,
      authenticatedWorkspaceId,
    },
    async (rawParams) => {
      const params = rawParams as z.infer<z.ZodObject<typeof streamingInputSchema>> & { workspaceId: string };
      pruneExpansions();
      const start = Date.now();

      try {
        const retrievalOpts: Parameters<typeof retrieveContext>[2] = {
          workspaceId: params.workspaceId,
          topK: params.topK ?? 10,
          expandRelationships: false,
          maxDepth: 1,
          openAiApiKey: openAiKey,
        };
        if (params.entityTypes !== undefined) retrievalOpts.entityTypes = params.entityTypes;

        const result = await retrieveContext(params.query, vectorStore, retrievalOpts);
        const entities = result.entities;

        const entityTypes = [...new Set(entities.map((e) => e.type))];
        const predictedLevel =
          params.expansionLevel ?? predictExpansionLevel(params.query, entityTypes);

        const rendered = renderAtLevel(entities, predictedLevel, params.initialBudget ?? 500);

        // Store entities for potential expansion request
        const expansionKey = generateExpansionKey();
        EXPANSION_STORE.set(expansionKey, {
          workspaceId: params.workspaceId,
          query: params.query,
          entities,
          createdAt: Date.now(),
        });

        const expansionNote = rendered.truncated
          ? `\n\n[partial: true | expansionKey: ${expansionKey} | call get-context-expansion to retrieve more]`
          : `\n\n[complete at ${predictedLevel} level | expansionKey: ${expansionKey} for deeper expansion]`;

        log.info('Streaming context returned', {
          workspaceId: params.workspaceId,
          entityCount: entities.length,
          tokenEstimate: rendered.tokenEstimate,
          level: predictedLevel,
          truncated: rendered.truncated,
          durationMs: Date.now() - start,
        });

        return {
          content: [{ type: 'text' as const, text: rendered.content + expansionNote }],
        };
      } catch (err) {
        log.error('streaming-context failed', { error: err });
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // Tool 2: get-context-expansion — fetches a deeper level using the stored expansionKey
  registerTool(
    server,
    'get-context-expansion',
    {
      title: 'Get Context Expansion',
      description:
        'Expand a previous streaming-context response to a more detailed level. ' +
        'Requires the expansionKey returned by streaming-context.',
      inputSchema: expansionInputSchema,
      authenticatedWorkspaceId,
    },
    async (rawParams) => {
      const params = rawParams as z.infer<z.ZodObject<typeof expansionInputSchema>> & { workspaceId: string };
      try {
        const entry = EXPANSION_STORE.get(params.expansionKey);

        if (!entry) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: expansionKey ${params.expansionKey} not found or expired. Re-issue streaming-context.`,
              },
            ],
            isError: true,
          };
        }

        if (entry.workspaceId !== params.workspaceId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: workspace mismatch for expansion key' }],
            isError: true,
          };
        }

        const rendered = renderAtLevel(
          entry.entities,
          params.targetLevel,
          params.additionalBudget ?? 1500,
        );

        log.info('Context expansion returned', {
          expansionKey: params.expansionKey,
          workspaceId: params.workspaceId,
          targetLevel: params.targetLevel,
          entityCount: entry.entities.length,
          tokenEstimate: rendered.tokenEstimate,
          truncated: rendered.truncated,
        });

        const suffix = rendered.truncated
          ? `\n\n[still truncated — increase additionalBudget or refine your query]`
          : `\n\n[complete at ${params.targetLevel} level]`;

        return {
          content: [{ type: 'text' as const, text: rendered.content + suffix }],
        };
      } catch (err) {
        log.error('get-context-expansion failed', { error: err });
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
