import type { Redis } from 'ioredis';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'semantic-cache' });

export interface CacheEntry {
  id: string;
  queryEmbedding: number[];
  response: string;
  tokenCount: number;
  workspaceId: string;
  entityIds: string[];
  createdAt: Date;
  expiresAt: Date;
}

export interface SemanticCacheConfig {
  /** Cosine similarity threshold for cache hit. Default: 0.92 */
  hitThreshold: number;
  /** TTL in seconds. Default: 3600 (1 hour) */
  ttlSeconds: number;
  /** Maximum cache entries per workspace. Default: 10_000 */
  maxEntriesPerWorkspace: number;
}

export const DEFAULT_CACHE_CONFIG: SemanticCacheConfig = {
  hitThreshold: 0.92,
  ttlSeconds: 3600,
  maxEntriesPerWorkspace: 10_000,
};

function entriesKey(workspaceId: string): string {
  return `iris:cache:${workspaceId}:entries`;
}

function entityIndexKey(workspaceId: string, entityId: string): string {
  return `iris:cache:${workspaceId}:entity:${entityId}`;
}

function cosineSimilarity(a: number[], b: number[]): number {
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
 * Semantic cache backed by Redis hashes.
 * Entries are stored per-workspace; lookup scans all entries and checks cosine similarity.
 */
export class SemanticCache {
  private readonly config: SemanticCacheConfig;

  /**
   * @param redis  - ioredis client (caller owns connection lifecycle)
   * @param config - Cache configuration overrides
   */
  constructor(
    private readonly redis: Redis,
    config: Partial<SemanticCacheConfig> = {},
  ) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Look up a cached response for the given query embedding.
   * Returns null on cache miss.
   *
   * @param queryEmbedding - Pre-computed embedding vector for the query
   * @param workspaceId    - Workspace scope for cache isolation
   */
  async get(queryEmbedding: number[], workspaceId: string): Promise<CacheEntry | null> {
    const allEntries = await this.redis.hvals(entriesKey(workspaceId));
    const now = Date.now();

    let bestEntry: CacheEntry | null = null;
    let bestScore = -1;

    for (const raw of allEntries) {
      let entry: CacheEntry;
      try {
        entry = JSON.parse(raw) as CacheEntry;
      } catch {
        continue;
      }

      if (new Date(entry.expiresAt).getTime() < now) continue;

      const score = cosineSimilarity(queryEmbedding, entry.queryEmbedding);
      if (score >= this.config.hitThreshold && score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (bestEntry) {
      log.debug('Semantic cache hit', {
        workspaceId,
        entryId: bestEntry.id,
        similarity: bestScore,
      });
    } else {
      log.debug('Semantic cache miss', { workspaceId });
    }

    return bestEntry;
  }

  /**
   * Store a response in the semantic cache with TTL.
   *
   * @param queryEmbedding - Embedding of the query
   * @param response       - Context string to cache
   * @param tokenCount     - Token count for analytics
   * @param workspaceId    - Workspace scope
   * @param entityIds      - Entity IDs in the response (for invalidation)
   */
  async set(
    queryEmbedding: number[],
    response: string,
    tokenCount: number,
    workspaceId: string,
    entityIds: string[],
  ): Promise<void> {
    const id = `${workspaceId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const entry: CacheEntry = {
      id,
      queryEmbedding,
      response,
      tokenCount,
      workspaceId,
      entityIds,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.ttlSeconds * 1000),
    };

    const pipeline = this.redis.pipeline();

    pipeline.hset(entriesKey(workspaceId), id, JSON.stringify(entry));
    pipeline.expire(entriesKey(workspaceId), this.config.ttlSeconds);

    for (const entityId of entityIds) {
      pipeline.sadd(entityIndexKey(workspaceId, entityId), id);
      pipeline.expire(entityIndexKey(workspaceId, entityId), this.config.ttlSeconds);
    }

    await pipeline.exec();

    log.debug('Semantic cache set', { workspaceId, entryId: id, tokenCount, entityCount: entityIds.length });
  }

  /**
   * Invalidate all cache entries containing any of the given entity IDs.
   *
   * @param entityIds   - Entity IDs whose cached responses should be purged
   * @param workspaceId - Workspace scope
   * @returns Number of entries invalidated
   */
  async invalidate(entityIds: string[], workspaceId: string): Promise<number> {
    if (entityIds.length === 0) return 0;

    const entryIdsToDelete = new Set<string>();

    for (const entityId of entityIds) {
      const key = entityIndexKey(workspaceId, entityId);
      const ids = await this.redis.smembers(key);
      for (const id of ids) entryIdsToDelete.add(id);
    }

    if (entryIdsToDelete.size === 0) return 0;

    const pipeline = this.redis.pipeline();
    const hashKey = entriesKey(workspaceId);

    for (const id of entryIdsToDelete) {
      pipeline.hdel(hashKey, id);
    }

    for (const entityId of entityIds) {
      pipeline.del(entityIndexKey(workspaceId, entityId));
    }

    await pipeline.exec();

    log.info('Semantic cache invalidated', {
      workspaceId,
      entityCount: entityIds.length,
      entryCount: entryIdsToDelete.size,
    });

    return entryIdsToDelete.size;
  }
}
