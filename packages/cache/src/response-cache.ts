import { createHash } from 'crypto';
import type { Redis } from 'ioredis';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'response-cache' });

const KEY_PREFIX = 'iris:resp';
const STATS_PREFIX = 'iris:resp:stats';

/** TTL in seconds, keyed by MCP tool name. Default: 300 (5 min). */
export const TOOL_TTL_SECONDS: Record<string, number> = {
  'query-context': 120,
  'list-entities': 300,
  'get-entity': 300,
  'get-metric': 3600,
  'list-glossary': 3600,
  'advanced-query-context': 120,
};

export const DEFAULT_TTL_SECONDS = 300;

export type McpToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
};

export type CacheStats = {
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  toolStats: Record<string, { hits: number; misses: number }>;
  approxKeyCount: number;
};

function inputHash(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Response-level cache for MCP tool outputs.
 * Stores serialized MCP responses in Redis with per-tool TTLs.
 * Tracks hit/miss counters for stats reporting.
 */
export class ResponseCache {
  constructor(private readonly redis: Redis) {}

  /**
   * Build the Redis key for a tool response.
   *
   * @param toolName - MCP tool name (e.g. 'query-context')
   * @param workspaceId - Tenant workspace
   * @param input - Validated tool input parameters
   * @returns Deterministic Redis key
   */
  cacheKey(toolName: string, workspaceId: string, input: Record<string, unknown>): string {
    return `${KEY_PREFIX}:${toolName}:${workspaceId}:${inputHash(input)}`;
  }

  /**
   * Look up a cached response.
   *
   * @param key - Redis key from cacheKey()
   * @returns Cached response or null on miss
   */
  async get(key: string): Promise<McpToolResponse | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as McpToolResponse;
    } catch (e) {
      log.warn('Response cache get failed', { key, error: String(e) });
      return null;
    }
  }

  /**
   * Store a tool response with TTL.
   *
   * @param key - Redis key from cacheKey()
   * @param response - MCP tool response to cache
   * @param ttlSeconds - TTL in seconds
   */
  async set(key: string, response: McpToolResponse, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(response), 'EX', ttlSeconds);
    } catch (e) {
      log.warn('Response cache set failed (non-fatal)', { key, error: String(e) });
    }
  }

  /**
   * Invalidate all keys matching a glob pattern.
   * Uses Redis SCAN to avoid blocking the server.
   *
   * @param pattern - Redis glob pattern (e.g. 'iris:resp:query-context:ws-1:*')
   * @returns Number of keys deleted
   */
  async invalidate(pattern: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    try {
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');
    } catch (e) {
      log.warn('Response cache invalidate failed', { pattern, error: String(e) });
    }
    return deleted;
  }

  /**
   * Invalidate all responses for a specific workspace.
   *
   * @param workspaceId - Workspace whose cache to clear
   * @returns Number of keys deleted
   */
  async invalidateWorkspace(workspaceId: string): Promise<number> {
    return this.invalidate(`${KEY_PREFIX}:*:${workspaceId}:*`);
  }

  /**
   * Record a cache hit for a tool.
   *
   * @param toolName - Tool that was hit
   */
  async recordHit(toolName: string): Promise<void> {
    try {
      await this.redis.incr(`${STATS_PREFIX}:hits`);
      await this.redis.incr(`${STATS_PREFIX}:${toolName}:hits`);
    } catch {
      // non-fatal
    }
  }

  /**
   * Record a cache miss for a tool.
   *
   * @param toolName - Tool that missed
   */
  async recordMiss(toolName: string): Promise<void> {
    try {
      await this.redis.incr(`${STATS_PREFIX}:misses`);
      await this.redis.incr(`${STATS_PREFIX}:${toolName}:misses`);
    } catch {
      // non-fatal
    }
  }

  /**
   * Get aggregate cache statistics.
   *
   * @returns CacheStats with hit rate and per-tool breakdown
   */
  async getStats(): Promise<CacheStats> {
    try {
      const [hitsRaw, missesRaw] = await Promise.all([
        this.redis.get(`${STATS_PREFIX}:hits`),
        this.redis.get(`${STATS_PREFIX}:misses`),
      ]);

      const totalHits = parseInt(hitsRaw ?? '0', 10);
      const totalMisses = parseInt(missesRaw ?? '0', 10);
      const total = totalHits + totalMisses;
      const hitRate = total > 0 ? totalHits / total : 0;

      const toolNames = Object.keys(TOOL_TTL_SECONDS);
      const toolStatEntries = await Promise.all(
        toolNames.map(async (tool) => {
          const [th, tm] = await Promise.all([
            this.redis.get(`${STATS_PREFIX}:${tool}:hits`),
            this.redis.get(`${STATS_PREFIX}:${tool}:misses`),
          ]);
          return [tool, { hits: parseInt(th ?? '0', 10), misses: parseInt(tm ?? '0', 10) }] as const;
        }),
      );
      const toolStats = Object.fromEntries(toolStatEntries);

      const keyCount = await this.redis.dbsize();

      return { totalHits, totalMisses, hitRate, toolStats, approxKeyCount: keyCount };
    } catch {
      return { totalHits: 0, totalMisses: 0, hitRate: 0, toolStats: {}, approxKeyCount: 0 };
    }
  }

  /**
   * Reset all hit/miss counters (useful for testing or admin resets).
   */
  async resetStats(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${STATS_PREFIX}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch {
      // non-fatal
    }
  }
}

/**
 * Wrap an MCP tool handler with response-level caching.
 * On cache hit: return cached value immediately and record hit.
 * On cache miss: execute handler, cache result, record miss.
 *
 * @param toolName - MCP tool name
 * @param workspaceId - Tenant workspace
 * @param input - Validated tool input
 * @param cache - ResponseCache instance
 * @param handler - Actual tool handler to execute on miss
 * @returns MCP tool response (from cache or freshly computed)
 */
export async function withResponseCache(
  toolName: string,
  workspaceId: string,
  input: Record<string, unknown>,
  cache: ResponseCache,
  handler: () => Promise<McpToolResponse>,
): Promise<McpToolResponse> {
  const key = cache.cacheKey(toolName, workspaceId, input);
  const ttl = TOOL_TTL_SECONDS[toolName] ?? DEFAULT_TTL_SECONDS;

  const cached = await cache.get(key);
  if (cached) {
    log.debug('Response cache hit', { toolName, workspaceId });
    void cache.recordHit(toolName);
    return cached;
  }

  void cache.recordMiss(toolName);
  const response = await handler();
  void cache.set(key, response, ttl);
  return response;
}
