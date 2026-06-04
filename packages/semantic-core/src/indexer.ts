/**
 * SemanticIndexer — core indexing pipeline.
 *
 * Responsibilities:
 * - Accept SemanticEntity objects from connector sync generators
 * - Generate vector embeddings via the configured embedding service
 * - Perform semantic deduplication before write (cosine similarity > dedupThreshold)
 * - Upsert entities into the vector store and relational DB
 * - Update the entity relationship graph
 * - Invalidate stale semantic cache entries for affected entities
 *
 * @see docs/architecture.md#data-flow-sync
 * @see .claude/rules/embedding-patterns.md
 */

import type { SemanticEntity } from '@iris/connector-sdk';

export interface IndexerConfig {
  /** Cosine similarity threshold above which two entities are considered duplicates. Default: 0.85 */
  dedupThreshold: number;
  /** Embedding model to use. Must match .claude/rules/embedding-patterns.md */
  embeddingModel: 'text-embedding-3-small' | 'text-embedding-3-large';
  /** Number of entities to batch per embedding API call. Default: 100 */
  batchSize: number;
}

export interface IndexResult {
  created: number;
  updated: number;
  deduplicated: number;
  failed: number;
  durationMs: number;
}

export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
  dedupThreshold: 0.85,
  embeddingModel: 'text-embedding-3-small',
  batchSize: 100,
};

/**
 * Index a stream of SemanticEntity objects from a connector sync run.
 *
 * Accepts an AsyncGenerator so it can process entities in a streaming fashion
 * without buffering the entire dataset in memory.
 *
 * @param entities - Async generator of semantic entities from a connector
 * @param config   - Indexer configuration
 * @returns        - Summary of the index run
 */
export async function indexEntities(
  entities: AsyncGenerator<SemanticEntity>,
  config: Partial<IndexerConfig> = {},
): Promise<IndexResult> {
  const opts = { ...DEFAULT_INDEXER_CONFIG, ...config };
  const result: IndexResult = { created: 0, updated: 0, deduplicated: 0, failed: 0, durationMs: 0 };
  const startMs = Date.now();

  const batch: SemanticEntity[] = [];

  for await (const entity of entities) {
    batch.push(entity);
    if (batch.length >= opts.batchSize) {
      await flushBatch(batch, opts, result);
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    await flushBatch(batch, opts, result);
  }

  result.durationMs = Date.now() - startMs;
  return result;
}

async function flushBatch(
  batch: SemanticEntity[],
  _config: IndexerConfig,
  result: IndexResult,
): Promise<void> {
  // TODO: Step 1 — generate embeddings for each entity in batch (see embedding-patterns.md)
  // TODO: Step 2 — query vector store for near-neighbors; deduplicate if similarity > dedupThreshold
  // TODO: Step 3 — upsert non-duplicate entities into vector store + relational DB
  // TODO: Step 4 — update entity graph (upsert relationships)
  // TODO: Step 5 — emit cache invalidation events for affected entity IDs

  // Placeholder: count all as created
  result.created += batch.length;
}
