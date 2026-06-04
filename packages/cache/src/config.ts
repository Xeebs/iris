/**
 * Cache configuration — shared settings for semantic cache and prefix cache.
 *
 * These defaults can be overridden per workspace via the admin API.
 * All values are also available as environment variables (prefix: IRIS_CACHE_).
 */

export interface CacheConfig {
  semantic: {
    /** Cosine similarity threshold for semantic cache hit. Range: 0–1. Default: 0.92 */
    hitThreshold: number;
    /** Entry TTL in seconds. Default: 3600 */
    ttlSeconds: number;
    /** Max cache entries per workspace before LRU eviction. Default: 10_000 */
    maxEntriesPerWorkspace: number;
  };
  prefix: {
    /**
     * System prompt sections that are prefix-cached must be placed FIRST in the prompt
     * and must be static across requests. Any dynamic content placed before static content
     * will bust the prefix cache.
     *
     * Minimum token count to qualify for prefix cache (Anthropic minimum: 1024 tokens).
     */
    minTokensForCaching: number;
  };
  redis: {
    url: string;
    keyPrefix: string;
    /** TTL for session/auth cache. Default: 900 (15 min) */
    sessionTtlSeconds: number;
  };
}

export function loadCacheConfig(): CacheConfig {
  return {
    semantic: {
      hitThreshold: Number(process.env.IRIS_CACHE_SEMANTIC_THRESHOLD ?? 0.92),
      ttlSeconds: Number(process.env.IRIS_CACHE_TTL_SECONDS ?? 3600),
      maxEntriesPerWorkspace: Number(process.env.IRIS_CACHE_MAX_ENTRIES ?? 10_000),
    },
    prefix: {
      minTokensForCaching: 1024,
    },
    redis: {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      keyPrefix: 'iris:',
      sessionTtlSeconds: 900,
    },
  };
}
