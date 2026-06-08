import { AzureOpenAI } from 'openai';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';
import { EMBEDDING_MODEL } from './embedding.js';
import type { VectorStore } from './vector-store.js';
import { detectEntityTypes } from './query-decomposer.js';
import type { Result } from 'neverthrow';

// Minimal graph interface — Neo4jGraphStore satisfies this via structural typing
interface RelatedEntityResult {
  id: string;
  type: string;
  label: string;
  relationshipType: string;
  workspaceId: string;
}

interface GraphExpander {
  getRelated(entityId: string, workspaceId: string, relType?: string, limit?: number): Promise<Result<RelatedEntityResult[], Error>>;
}

const log = logger.child({ service: 'retrieval' });

export interface RetrievalOptions {
  /** Workspace ID — enforced on every query to prevent cross-tenant data leaks */
  workspaceId: string;
  /** Maximum entities to return. Default: 10 */
  topK: number;
  /** Optionally filter by entity type (e.g., ['deal', 'contact']) — auto-detected when omitted */
  entityTypes?: string[];
  /** All entity types indexed in this workspace — used for auto-detection when entityTypes is unset */
  availableEntityTypes?: string[];
  /** Whether to expand results via relationship graph traversal. Default: true */
  expandRelationships: boolean;
  /** Max graph traversal depth. Default: 1 (direct relationships only) */
  maxDepth: number;
  /** OpenAI API key for query embedding and entity type detection */
  openAiApiKey?: string;
  /** Optional graph store for relationship expansion. When omitted, falls back to entity.relationships */
  graphStore?: GraphExpander;
  /** When true, use QueryDecomposer to auto-detect entity types from the query */
  autoDetectEntityTypes?: boolean;
  /**
   * When true, run BM25 lexical search in parallel with vector search and merge results
   * via Reciprocal Rank Fusion (RRF). Default: true if vectorStore supports bm25Search.
   */
  hybridSearch?: boolean;
  /** RRF rank constant k. Higher k reduces the impact of rank differences. Default: 60 */
  rrfK?: number;
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
  const queryVector = await embedQuery(query);
  const queryEmbeddingMs = Date.now() - embeddingStart;

  // Auto-detect entity types from the query when caller hasn't specified them
  let resolvedEntityTypes = opts.entityTypes;
  if (opts.autoDetectEntityTypes && resolvedEntityTypes === undefined && opts.availableEntityTypes) {
    const detected = await detectEntityTypes(query, opts.availableEntityTypes, opts.openAiApiKey);
    if (detected.length < opts.availableEntityTypes.length) {
      resolvedEntityTypes = detected;
      log.debug('Auto-detected entity types', { types: resolvedEntityTypes });
    }
  }

  const searchStart = Date.now();
  const vectorFilter = {
    workspaceId: opts.workspaceId,
    ...(resolvedEntityTypes !== undefined ? { entityTypes: resolvedEntityTypes } : {}),
  };

  const useHybrid = (opts.hybridSearch ?? true) && typeof vectorStore.bm25Search === 'function';

  let searchResults;
  if (useHybrid) {
    const [vectorResults, bm25Results] = await Promise.all([
      vectorStore.search(queryVector, opts.topK * 2, vectorFilter),
      vectorStore.bm25Search!(opts.workspaceId, query, opts.topK * 2, resolvedEntityTypes),
    ]);
    searchResults = reciprocalRankFusion(vectorResults, bm25Results, opts.rrfK ?? 60).slice(0, opts.topK);
    log.debug('Hybrid search: RRF merge complete', {
      vectorHits: vectorResults.length,
      bm25Hits: bm25Results.length,
      mergedHits: searchResults.length,
    });
  } else {
    searchResults = await vectorStore.search(queryVector, opts.topK, vectorFilter);
  }
  const vectorSearchMs = Date.now() - searchStart;

  const graphStart = Date.now();
  let expanded = searchResults.map((r) => r.entity);
  let scores = searchResults.map((r) => r.score);

  if (opts.expandRelationships && opts.maxDepth > 0) {
    const expandedResult = await expandViaRelationships(expanded, scores, vectorStore, opts);
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

async function embedQuery(query: string): Promise<number[]> {
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  const apiKey = process.env['AZURE_OPENAI_API_KEY'];
  const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2023-05-15';
  const deployment = process.env['AZURE_OPENAI_SMALL_DEPLOYMENT'] ?? 'text-embedding-3-small';

  if (!endpoint || !apiKey) {
    throw new IndexerError('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set');
  }

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });
  let response;
  try {
    response = await client.embeddings.create({ model: deployment, input: query });
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

  if (opts.graphStore) {
    // Preferred path: use the graph store to find related entity IDs, then fetch from vector store
    for (const entity of entities) {
      const relResult = await opts.graphStore.getRelated(entity.id, opts.workspaceId);
      if (relResult.isErr()) {
        log.warn('Graph expansion failed for entity', { entityId: entity.id, error: relResult.error });
        continue;
      }

      for (const related of relResult.value) {
        if (seenIds.has(related.id)) continue;

        const found = await vectorStore.getById(opts.workspaceId, related.id);
        if (found) {
          expanded.push(found);
          expandedScores.push(0.5); // relationship-expanded entities get a fixed lower score
          seenIds.add(related.id);
        }
      }
    }
  } else {
    // Fallback path: use inline entity.relationships array and look up by ID
    for (const entity of entities) {
      for (const rel of entity.relationships) {
        if (seenIds.has(rel.targetId)) continue;

        const found = await vectorStore.getById(opts.workspaceId, rel.targetId);
        if (found) {
          expanded.push(found);
          expandedScores.push(0.5);
          seenIds.add(rel.targetId);
        }
      }
    }
  }

  return { entities: expanded, scores: expandedScores };
}

/**
 * Reciprocal Rank Fusion — combine two ranked result lists into one.
 * score(d) = Σ 1/(k + rank(d)) over each list that contains d.
 * Results are sorted by combined score descending.
 *
 * @param listA - First ranked list (typically vector search)
 * @param listB - Second ranked list (typically BM25)
 * @param k     - RRF smoothing constant (default 60, from the original RRF paper)
 */
export function reciprocalRankFusion(
  listA: import('./vector-store.js').VectorSearchResult[],
  listB: import('./vector-store.js').VectorSearchResult[],
  k = 60,
): import('./vector-store.js').VectorSearchResult[] {
  const scores = new Map<string, number>();
  const entities = new Map<string, import('@iris/connector-sdk').SemanticEntity>();

  for (let i = 0; i < listA.length; i++) {
    const item = listA[i]!;
    const current = scores.get(item.entity.id) ?? 0;
    scores.set(item.entity.id, current + 1 / (k + i + 1));
    entities.set(item.entity.id, item.entity);
  }

  for (let i = 0; i < listB.length; i++) {
    const item = listB[i]!;
    const current = scores.get(item.entity.id) ?? 0;
    scores.set(item.entity.id, current + 1 / (k + i + 1));
    entities.set(item.entity.id, item.entity);
  }

  return Array.from(scores.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([id, score]) => ({ entity: entities.get(id)!, score }));
}
