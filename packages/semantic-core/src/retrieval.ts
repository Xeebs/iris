import OpenAI from 'openai';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';
import { EMBEDDING_MODEL } from './embedding.js';
import type { VectorStore } from './vector-store.js';

const log = logger.child({ service: 'retrieval' });

export interface RetrievalOptions {
  /** Workspace ID — enforced on every query to prevent cross-tenant data leaks */
  workspaceId: string;
  /** Maximum entities to return. Default: 10 */
  topK: number;
  /** Optionally filter by entity type (e.g., ['deal', 'contact']) */
  entityTypes?: string[];
  /** Whether to expand results via relationship graph traversal. Default: true */
  expandRelationships: boolean;
  /** Max graph traversal depth. Default: 1 (direct relationships only) */
  maxDepth: number;
  /** OpenAI API key for query embedding */
  openAiApiKey?: string;
}

export interface RetrievalResult {
  entities: SemanticEntity[];
  scores: number[];
  fromCache: boolean;
  queryEmbeddingMs: number;
  vectorSearchMs: number;
  graphExpansionMs: number;
}

export const DEFAULT_RETRIEVAL_OPTIONS: Omit<RetrievalOptions, 'workspaceId'> = {
  topK: 10,
  expandRelationships: true,
  maxDepth: 1,
};

/**
 * Retrieve semantically relevant entities for a natural language query.
 * One embedding call per MCP request per embedding-patterns.md cost rules.
 *
 * @param query       - Natural language query from the AI tool
 * @param vectorStore - Initialized VectorStore for similarity search
 * @param options     - Retrieval configuration
 */
export async function retrieveContext(
  query: string,
  vectorStore: VectorStore,
  options: RetrievalOptions,
): Promise<RetrievalResult> {
  const opts = { ...DEFAULT_RETRIEVAL_OPTIONS, ...options };

  const embeddingStart = Date.now();
  const queryVector = await embedQuery(query, opts.openAiApiKey);
  const queryEmbeddingMs = Date.now() - embeddingStart;

  const searchStart = Date.now();
  const searchResults = await vectorStore.search(queryVector, opts.topK, {
    workspaceId: opts.workspaceId,
    ...(opts.entityTypes !== undefined ? { entityTypes: opts.entityTypes } : {}),
  });
  const vectorSearchMs = Date.now() - searchStart;

  const graphStart = Date.now();
  let expanded = searchResults.map((r) => r.entity);
  let scores = searchResults.map((r) => r.score);

  if (opts.expandRelationships && opts.maxDepth > 0) {
    const expandedResult = await expandViaRelationships(
      expanded,
      scores,
      vectorStore,
      opts,
    );
    expanded = expandedResult.entities;
    scores = expandedResult.scores;
  }
  const graphExpansionMs = Date.now() - graphStart;

  log.info('Retrieved context', {
    query: query.slice(0, 50),
    topK: opts.topK,
    resultsCount: expanded.length,
    queryEmbeddingMs,
    vectorSearchMs,
    graphExpansionMs,
  });

  return {
    entities: expanded,
    scores,
    fromCache: false,
    queryEmbeddingMs,
    vectorSearchMs,
    graphExpansionMs,
  };
}

async function embedQuery(query: string, apiKey?: string): Promise<number[]> {
  const client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });
  let response;
  try {
    response = await client.embeddings.create({ model: EMBEDDING_MODEL, input: query });
  } catch (e) {
    throw new IndexerError(
      `Failed to embed query: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
  return response.data[0]?.embedding ?? [];
}

async function expandViaRelationships(
  entities: SemanticEntity[],
  scores: number[],
  vectorStore: VectorStore,
  opts: RetrievalOptions,
): Promise<{ entities: SemanticEntity[]; scores: number[] }> {
  const seenIds = new Set(entities.map((e) => e.id));
  const expanded = [...entities];
  const expandedScores = [...scores];

  for (const entity of entities) {
    for (const rel of entity.relationships) {
      if (seenIds.has(rel.targetId)) continue;

      const results = await vectorStore.search(
        new Array(1536).fill(0) as number[],
        1,
        { workspaceId: opts.workspaceId },
      );

      const found = results.find((r) => r.entity.id === rel.targetId);
      if (found) {
        expanded.push(found.entity);
        expandedScores.push(found.score * 0.8); // discount relationship-expanded entities
        seenIds.add(rel.targetId);
      }
    }
  }

  return { entities: expanded, scores: expandedScores };
}
