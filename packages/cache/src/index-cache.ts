import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'index-cache' });

export interface IndexCacheEntry {
  queryVector: number[];
  entityIds: string[];
  scores: number[];
  cachedAt: number;
}

export interface IndexCacheConfig {
  /** Maximum number of cache entries. Default: 1000 */
  maxEntries: number;
  /** Entry TTL in milliseconds. Default: 300_000 (5 min) */
  ttlMs: number;
}

export const DEFAULT_INDEX_CACHE_CONFIG: IndexCacheConfig = {
  maxEntries: 1_000,
  ttlMs: 300_000,
};

/**
 * In-process LRU cache for vector index query results.
 *
 * Stores query vectors → entity ID lists so that repeat queries avoid a full
 * pgvector ANN scan. Bounded by maxEntries with LRU eviction. Not shared across
 * processes — each API/MCP instance has its own cache.
 *
 * Per embedding-patterns.md: never store raw vectors in memory across requests for
 * arbitrary queries; this cache is intentionally size-bounded and short-TTL.
 */
export class IndexCache {
  private readonly cache = new Map<string, IndexCacheEntry>();
  private readonly config: IndexCacheConfig;

  constructor(config: Partial<IndexCacheConfig> = {}) {
    this.config = { ...DEFAULT_INDEX_CACHE_CONFIG, ...config };
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Look up cached query results. Returns null on cache miss or expired entry.
   *
   * @param cacheKey - Unique key for the query (hash of vector + filters)
   */
  get(cacheKey: string): IndexCacheEntry | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.cache.delete(cacheKey);
      return null;
    }

    // LRU: move to end by deleting and re-inserting
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, entry);
    return entry;
  }

  /**
   * Store query results in the cache, evicting the oldest entry if at capacity.
   *
   * @param cacheKey   - Unique key for the query
   * @param entry      - Result to cache
   */
  set(cacheKey: string, entry: Omit<IndexCacheEntry, 'cachedAt'>): void {
    if (this.cache.size >= this.config.maxEntries) {
      // Evict the oldest entry (Map preserves insertion order)
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
        log.debug('Index cache eviction', { evicted: oldest, size: this.cache.size });
      }
    }
    this.cache.set(cacheKey, { ...entry, cachedAt: Date.now() });
  }

  /**
   * Remove all entries for a given workspace (called on entity updates).
   * Uses a prefix scan — keys should be prefixed with workspaceId.
   *
   * @param workspaceId - Workspace whose entries to invalidate
   */
  invalidateWorkspace(workspaceId: string): number {
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${workspaceId}:`)) {
        this.cache.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      log.info('Index cache invalidated', { workspaceId, removed });
    }
    return removed;
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Build a cache key for a query vector + optional entity type filters.
   * Uses a fast hash — not cryptographic, just for cache lookup.
   *
   * @param workspaceId - Tenant workspace
   * @param vector      - Query embedding (first 8 dimensions provide sufficient uniqueness)
   * @param entityTypes - Optional entity type filter
   * @param topK        - Number of results requested
   */
  static buildKey(
    workspaceId: string,
    vector: number[],
    entityTypes: string[] | undefined,
    topK: number,
  ): string {
    // Sample 8 evenly-spaced dimensions for the key — 1536 dims × 4 bytes = 6KB per key is too large
    const stride = Math.max(1, Math.floor(vector.length / 8));
    const sample = Array.from({ length: 8 }, (_, i) => (vector[i * stride] ?? 0).toFixed(4)).join(',');
    const types = entityTypes?.sort().join(',') ?? '*';
    return `${workspaceId}:${topK}:${types}:${sample}`;
  }
}
