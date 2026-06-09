import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'smart-cache-manager' });

export type CacheEntry = {
  queryHash: string;
  result: string;
  ttl: number;
  dependencies: string[];
  hitCount: number;
  lastAccessed: Date;
  createdAt: Date;
  expiresAt: Date;
};

export type HitRateStats = {
  queryHash: string;
  totalRequests: number;
  cacheHits: number;
  hitRate: number;
};

export type PrefetchRecommendation = {
  queryHash: string;
  queryText: string;
  confidence: number;
  reason: string;
};

type Store = Map<string, CacheEntry>;
type DependencyIndex = Map<string, Set<string>>;

export class SmartCacheManager {
  private readonly store: Store = new Map();
  private readonly dependencyIndex: DependencyIndex = new Map();
  private readonly hitStats: Map<string, { total: number; hits: number }> = new Map();
  private readonly queryPatterns: Map<string, string[]> = new Map();

  /**
   * Store a query result with dependency tracking.
   * @param queryHash - Unique hash identifying the query
   * @param result - Serialized result string
   * @param ttl - Time-to-live in seconds
   * @param dependencies - Entity IDs that, if changed, should invalidate this entry
   */
  cacheQuery(queryHash: string, result: string, ttl: number, dependencies: string[]): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const existing = this.store.get(queryHash);

    this.store.set(queryHash, {
      queryHash,
      result,
      ttl,
      dependencies,
      hitCount: existing?.hitCount ?? 0,
      lastAccessed: now,
      createdAt: now,
      expiresAt,
    });

    // Build dependency → queries reverse index
    for (const entityId of dependencies) {
      const set = this.dependencyIndex.get(entityId) ?? new Set();
      set.add(queryHash);
      this.dependencyIndex.set(entityId, set);
    }

    // Update hit stats denominator
    const stats = this.hitStats.get(queryHash) ?? { total: 0, hits: 0 };
    stats.total++;
    this.hitStats.set(queryHash, stats);

    log.debug('Query cached', { queryHash, ttl, dependencyCount: dependencies.length });
  }

  /**
   * Retrieve a cached result, recording the hit.
   * @param queryHash - Query hash to look up
   * @returns Cached result string, or null if missing/expired
   */
  getQuery(queryHash: string): string | null {
    const entry = this.store.get(queryHash);
    if (!entry) return null;
    if (entry.expiresAt <= new Date()) {
      this.store.delete(queryHash);
      return null;
    }

    entry.hitCount++;
    entry.lastAccessed = new Date();

    const stats = this.hitStats.get(queryHash) ?? { total: 0, hits: 0 };
    stats.hits++;
    this.hitStats.set(queryHash, stats);

    return entry.result;
  }

  /**
   * Cascade invalidation: delete all cached queries that depend on the changed entity.
   * @param entityId - Entity ID that changed
   * @returns Number of entries invalidated
   */
  onEntityChange(entityId: string): number {
    const affected = this.dependencyIndex.get(entityId);
    if (!affected || affected.size === 0) return 0;

    let count = 0;
    for (const queryHash of affected) {
      if (this.store.delete(queryHash)) count++;
    }

    this.dependencyIndex.delete(entityId);
    log.info('Cache invalidated on entity change', { entityId, entriesInvalidated: count });
    return count;
  }

  /**
   * Get hit rate statistics for a query hash.
   * @param queryHash - Query to check
   * @returns HitRateStats or null if no data
   */
  getHitRate(queryHash: string): HitRateStats | null {
    const stats = this.hitStats.get(queryHash);
    if (!stats || stats.total === 0) return null;
    return {
      queryHash,
      totalRequests: stats.total,
      cacheHits: stats.hits,
      hitRate: stats.hits / stats.total,
    };
  }

  /**
   * Optimize TTL adaptively: frequently accessed entries get longer TTL, stale ones evict faster.
   * @param queryHash - Query to tune
   * @returns New TTL in seconds
   */
  optimizeCacheTtl(queryHash: string): number {
    const entry = this.store.get(queryHash);
    if (!entry) return 3600;

    const stats = this.hitStats.get(queryHash);
    const hitRate = stats ? stats.hits / Math.max(1, stats.total) : 0;
    const ageMs = Date.now() - entry.createdAt.getTime();
    const ageDays = ageMs / 86_400_000;

    let newTtl = entry.ttl;

    if (hitRate > 0.8 && ageDays < 1) {
      // Highly popular — double TTL up to 24 hours
      newTtl = Math.min(entry.ttl * 2, 86_400);
    } else if (hitRate < 0.2 && ageDays > 0.5) {
      // Rarely accessed — halve TTL down to 5 minutes
      newTtl = Math.max(Math.floor(entry.ttl / 2), 300);
    }

    if (newTtl !== entry.ttl) {
      entry.ttl = newTtl;
      entry.expiresAt = new Date(entry.lastAccessed.getTime() + newTtl * 1000);
      log.debug('TTL optimized', { queryHash, oldTtl: entry.ttl, newTtl, hitRate });
    }

    return newTtl;
  }

  /**
   * Record a user query pattern for prefetch prediction.
   * @param userId - User identifier
   * @param queryHash - Query hash observed
   * @param queryText - Human-readable query text
   */
  recordQueryPattern(userId: string, queryHash: string, queryText: string): void {
    const patterns = this.queryPatterns.get(userId) ?? [];
    // Keep last 20 queries per user
    patterns.push(`${queryHash}:${queryText}`);
    if (patterns.length > 20) patterns.shift();
    this.queryPatterns.set(userId, patterns);
  }

  /**
   * Predict and recommend queries to prefetch based on user history.
   * @param userId - User to generate prefetch recommendations for
   * @param limit - Max recommendations to return
   * @returns List of prefetch recommendations sorted by confidence
   */
  prefetchLikelyQueries(userId: string, limit = 5): PrefetchRecommendation[] {
    const patterns = this.queryPatterns.get(userId) ?? [];
    if (patterns.length < 2) return [];

    // Count query frequency in the user's history
    const frequency = new Map<string, { count: number; text: string }>();
    for (const p of patterns) {
      const [hash, ...textParts] = p.split(':');
      const text = textParts.join(':');
      if (!hash) continue;
      const entry = frequency.get(hash) ?? { count: 0, text: text ?? '' };
      entry.count++;
      frequency.set(hash, entry);
    }

    return Array.from(frequency.entries())
      .filter(([queryHash]) => !this.store.has(queryHash))
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, limit)
      .map(([queryHash, { count, text }]) => ({
        queryHash,
        queryText: text,
        confidence: Math.min(count / patterns.length, 1),
        reason: `Appears ${count} time(s) in recent history`,
      }));
  }

  /**
   * Get all entries that depend on a specific entity ID.
   * @param entityId - Entity to look up
   * @returns Array of query hashes
   */
  getDependencies(entityId: string): string[] {
    return Array.from(this.dependencyIndex.get(entityId) ?? []);
  }

  /**
   * Manually invalidate a specific cache entry.
   * @param queryHash - Query to remove
   * @returns true if entry existed and was removed
   */
  invalidate(queryHash: string): boolean {
    return this.store.delete(queryHash);
  }

  /**
   * Return aggregate cache statistics.
   */
  getStats(): { totalEntries: number; totalHits: number; totalRequests: number; avgHitRate: number } {
    let totalHits = 0;
    let totalRequests = 0;
    for (const s of this.hitStats.values()) {
      totalHits += s.hits;
      totalRequests += s.total;
    }
    return {
      totalEntries: this.store.size,
      totalHits,
      totalRequests,
      avgHitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
    };
  }
}
