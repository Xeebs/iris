import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { generateEmbeddings } from './embedding.js';
import type { VectorStore } from './vector-store.js';
import type { Result } from 'neverthrow';

// Minimal graph interface — Neo4jGraphStore satisfies this via structural typing
export interface RelationshipStore {
  addEntity(entity: { id: string; type: string; label: string }, workspaceId: string): Promise<Result<void, Error>>;
  addRelationship(sourceId: string, targetId: string, type: string, workspaceId: string): Promise<Result<void, Error>>;
}

const log = logger.child({ service: 'indexer' });

export interface IndexerConfig {
  /** Cosine similarity threshold above which two entities are considered duplicates. Default: 0.85 */
  dedupThreshold: number;
  /** Embedding model to use. Must match embedding-patterns.md */
  embeddingModel: 'text-embedding-3-small' | 'text-embedding-3-large';
  /** Number of entities to batch per embedding API call. Default: 100 */
  batchSize: number;
  /** OpenAI API key */
  openAiApiKey?: string;
  /** Workspace ID — required when graphStore is provided for relationship indexing */
  workspaceId?: string;
  /** Optional graph store for persisting entity relationships */
  graphStore?: RelationshipStore;
  /**
   * When set, called after large syncs (>= largeSync Threshold entities indexed) to
   * trigger a vector index health check. The caller is responsible for running the check.
   */
  onLargeSyncComplete?: (workspaceId: string, entityCount: number) => void;
  /** Minimum number of entities indexed before calling onLargeSyncComplete. Default: 500 */
  largeSyncThreshold?: number;
}

export interface IndexResult {
  created: number;
  updated: number;
  deduplicated: number;
  failed: number;
  durationMs: number;
  relationshipsIndexed: number;
}

export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
  dedupThreshold: 0.85,
  embeddingModel: 'text-embedding-3-small',
  batchSize: 100,
};

/**
 * Compute cosine similarity between two equal-length vectors.
 * Returns a value in [-1, 1]; 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Index a stream of SemanticEntity objects from a connector sync run.
 * Embeds, deduplicates, upserts to the vector store, and optionally
 * persists entity relationships to the knowledge graph.
 *
 * @param entities    - Async generator of semantic entities from a connector
 * @param vectorStore - Initialized VectorStore instance
 * @param config      - Indexer configuration (include graphStore + workspaceId for graph indexing)
 * @returns           - Summary of the index run
 */
export async function indexEntities(
  entities: AsyncGenerator<SemanticEntity>,
  vectorStore: VectorStore,
  config: Partial<IndexerConfig> = {},
): Promise<IndexResult> {
  const opts = { ...DEFAULT_INDEXER_CONFIG, ...config };
  const result: IndexResult = {
    created: 0,
    updated: 0,
    deduplicated: 0,
    failed: 0,
    durationMs: 0,
    relationshipsIndexed: 0,
  };
  const startMs = Date.now();
  const batch: SemanticEntity[] = [];

  for await (const entity of entities) {
    batch.push(entity);
    if (batch.length >= opts.batchSize) {
      await flushBatch(batch, opts, vectorStore, result);
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    await flushBatch(batch, opts, vectorStore, result);
  }

  result.durationMs = Date.now() - startMs;
  log.info('Indexing complete', { ...result });

  const indexedCount = result.created + result.updated;
  const threshold = opts.largeSyncThreshold ?? 500;
  if (opts.onLargeSyncComplete && opts.workspaceId && indexedCount >= threshold) {
    log.info('Large sync detected — triggering health check callback', {
      workspaceId: opts.workspaceId,
      indexedCount,
      threshold,
    });
    opts.onLargeSyncComplete(opts.workspaceId, indexedCount);
  }

  return result;
}

async function flushBatch(
  batch: SemanticEntity[],
  config: IndexerConfig,
  vectorStore: VectorStore,
  result: IndexResult,
): Promise<void> {
  const embeddingResults = await generateEmbeddings(batch, {
    model: config.embeddingModel,
    ...(config.openAiApiKey !== undefined ? { apiKey: config.openAiApiKey } : {}),
  });

  const vectors = embeddingResults.map((r) => r.vector);

  const toUpsert: SemanticEntity[] = [];
  const toUpsertVectors: number[][] = [];

  for (let i = 0; i < batch.length; i++) {
    const entity = batch[i]!;
    const vector = vectors[i]!;

    const existing = await vectorStore.search(vector, 1, { entityTypes: [entity.type] });
    const topResult = existing[0];

    if (topResult && topResult.entity.id !== entity.id && topResult.score >= config.dedupThreshold) {
      log.debug('Deduplicated entity', {
        entityId: entity.id,
        duplicateOf: topResult.entity.id,
        similarity: topResult.score,
      });
      result.deduplicated++;
      continue;
    }

    const isUpdate = existing.some((r) => r.entity.id === entity.id);
    if (isUpdate) {
      result.updated++;
    } else {
      result.created++;
    }

    toUpsert.push(entity);
    toUpsertVectors.push(vector);
  }

  if (toUpsert.length > 0) {
    await vectorStore.upsert(toUpsert, toUpsertVectors);
  }

  // Persist entity nodes and relationships to the knowledge graph
  if (config.graphStore && config.workspaceId) {
    await indexRelationships(toUpsert, config.graphStore, config.workspaceId, result);
  }
}

async function indexRelationships(
  entities: SemanticEntity[],
  graphStore: RelationshipStore,
  workspaceId: string,
  result: IndexResult,
): Promise<void> {
  for (const entity of entities) {
    const addResult = await graphStore.addEntity(entity, workspaceId);
    if (addResult.isErr()) {
      log.warn('Failed to add entity to graph', { entityId: entity.id, error: addResult.error });
      continue;
    }

    for (const rel of entity.relationships) {
      const relResult = await graphStore.addRelationship(
        entity.id,
        rel.targetId,
        rel.type,
        workspaceId,
      );
      if (relResult.isOk()) {
        result.relationshipsIndexed++;
      } else {
        log.warn('Failed to index relationship', {
          sourceId: entity.id,
          targetId: rel.targetId,
          type: rel.type,
          error: relResult.error,
        });
      }
    }
  }
}
