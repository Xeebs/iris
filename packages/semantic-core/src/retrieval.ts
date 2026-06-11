import { AzureOpenAI } from 'openai';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';
import { EMBEDDING_MODEL } from './embedding.js';
import { createDefaultProvider } from './embedding-provider.js';
import type { VectorStore } from './vector-store.js';
import { detectEntityTypes, expandQuery } from './query-decomposer.js';
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
  /**
   * Relative relevance floor: drop search results scoring below this fraction
   * of their list's top score, instead of always padding to topK. Applied to
   * the vector and BM25 lists separately, before RRF (RRF scores are
   * rank-based, so a relative cutoff is only meaningful per source list).
   * Reduces response tokens by excluding weakly-related entities.
   * 0 disables. Default: RETRIEVAL_RELEVANCE_CUTOFF env var, else 0.
   */
  relevanceCutoff?: number;
  /**
   * When true, calls expandQuery() to predict and prepend domain vocabulary to the query
   * before embedding. Requires openAiApiKey to be set. Default: false.
   */
  queryExpansion?: boolean;
  /** Postgres client for corpus frequency filtering during query expansion. */
  expansionSql?: import('postgres').Sql;
  /** Redis client for caching query expansion results (TTL: 1 hour). */
  expansionRedis?: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, expiryMode: 'EX', time: number): Promise<unknown>;
  };
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

  let embeddingInput = query;
  if (opts.queryExpansion && opts.openAiApiKey) {
    try {
      embeddingInput = await expandQuery(
        query,
        opts.workspaceId,
        opts.availableEntityTypes ?? [],
        opts.openAiApiKey,
        opts.expansionSql as import('postgres').Sql | undefined,
        opts.expansionRedis,
      );
      if (embeddingInput !== query) {
        log.debug('Query expanded for embedding', { workspaceId: opts.workspaceId });
      }
    } catch (e) {
      log.warn('Query expansion failed, using original query', { error: e });
    }
  }

  const embeddingStart = Date.now();
  const queryVector = await embedQuery(embeddingInput);
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
  const relevanceCutoff =
    opts.relevanceCutoff ?? Number(process.env['RETRIEVAL_RELEVANCE_CUTOFF'] ?? 0);

  let searchResults;
  if (useHybrid) {
    const [vectorResults, bm25Results] = await Promise.all([
      vectorStore.search(queryVector, opts.topK * 2, vectorFilter),
      vectorStore.bm25Search!(opts.workspaceId, query, opts.topK * 2, resolvedEntityTypes),
    ]);
    searchResults = reciprocalRankFusion(
      applyRelevanceCutoff(vectorResults, relevanceCutoff),
      applyRelevanceCutoff(bm25Results, relevanceCutoff),
      opts.rrfK ?? 60,
    ).slice(0, opts.topK);
    log.debug('Hybrid search: RRF merge complete', {
      vectorHits: vectorResults.length,
      bm25Hits: bm25Results.length,
      mergedHits: searchResults.length,
    });
  } else {
    searchResults = applyRelevanceCutoff(
      await vectorStore.search(queryVector, opts.topK, vectorFilter),
      relevanceCutoff,
    );
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
  // Query and index embeddings must come from the same model, so an explicit
  // EMBEDDING_PROVIDER env (as set at index time, e.g. hash-deterministic in
  // demo mode) takes precedence over the legacy Azure path.
  if (process.env['EMBEDDING_PROVIDER']) {
    return createDefaultProvider().getEmbedding(query);
  }

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

/**
 * Drop results scoring below `cutoff × top score` of their own list.
 * Expects results sorted by descending score (as returned by the store).
 * A topK search always returns topK rows even when most are barely related;
 * weakly-related entities waste response tokens without answering the query.
 *
 * @param results - Ranked results from a single search source
 * @param cutoff  - Fraction of the top score to require (0 disables)
 * @returns Results above the relative floor (always keeps the top result)
 */
export function applyRelevanceCutoff(
  results: import('./vector-store.js').VectorSearchResult[],
  cutoff: number,
): import('./vector-store.js').VectorSearchResult[] {
  const top = results[0]?.score;
  if (cutoff <= 0 || top === undefined || top <= 0) return results;
  return results.filter((r, i) => i === 0 || r.score > top * cutoff);
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
      // relationships round-trips through JSONB — tolerate malformed entries
      // (missing/non-string targetId) instead of poisoning the whole query:
      // postgres.js rejects undefined parameters with UNDEFINED_VALUE.
      const rels = Array.isArray(entity.relationships) ? entity.relationships : [];
      for (const rel of rels) {
        if (typeof rel?.targetId !== 'string' || rel.targetId.length === 0) {
          log.warn('Skipping malformed relationship during expansion', {
            entityId: entity.id,
            relationship: JSON.stringify(rel),
          });
          continue;
        }
        if (seenIds.has(rel.targetId)) continue;

        const found = await vectorStore.getById(opts.workspaceId, rel.targetId);
        if (found) {
          expanded.push(found);
          expandedScores.push(0.5);
          seenIds.add(rel.targetId);
        }
      }
    }

    // Reverse expansion: also find entities that reference the found entities.
    // Fixes queries like "contacts at Acme Corp" where the company is found first
    // but contacts point TO the company (not the other way around).
    if (vectorStore.getByRelationshipTarget) {
      for (const entity of entities) {
        const reverseRelated = await vectorStore.getByRelationshipTarget(opts.workspaceId, entity.id);
        for (const related of reverseRelated) {
          if (seenIds.has(related.id)) continue;
          expanded.push(related);
          expandedScores.push(0.5);
          seenIds.add(related.id);
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
