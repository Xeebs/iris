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
  const searchResults = await vectorStore.search(queryVector, opts.topK, {
    workspaceId: opts.workspaceId,
    ...(resolvedEntityTypes !== undefined ? { entityTypes: resolvedEntityTypes } : {}),
  });
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
