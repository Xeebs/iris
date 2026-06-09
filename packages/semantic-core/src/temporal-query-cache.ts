import { ok, err, type Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ module: 'temporal-query-cache' });

type CachedResult = {
  queryId: string;
  queryHash: string;
  result: unknown;
  asOfDate: Date;
  expiresAt: Date;
  hitCount: number;
  createdAt: Date;
};

type CacheHitRecord = {
  queryId: string;
  queryHash: string;
  hit: boolean;
  asOfDate: Date | null;
  latencyMs: number;
  missReason: string | null;
};

type CacheAnalytics = {
  intervalDays: number;
  totalRequests: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  topMissedQueries: { queryHash: string; missCount: number; lastMissedAt: Date }[];
  missPatterns: { reason: string; count: number }[];
};

type WarmingResult = {
  warmed: number;
  skipped: number;
  candidates: { queryHash: string; accessCount: number }[];
};

/**
 * Computes a short stable hash of a query string.
 * @param query - The query text
 * @returns 8-character hex hash
 */
export function hashQuery(query: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < query.length; i++) {
    h ^= query.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Normalizes a query string for consistent hashing.
 * @param query - Raw query text
 * @returns Trimmed lowercased query
 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Returns true if an entry cached on cacheDate is valid for targetDate (same calendar day or earlier).
 * @param cacheDate - Date the result was cached
 * @param targetDate - The as-of date being requested
 * @returns Whether this cache entry satisfies the requested date
 */
export function isDateCompatible(cacheDate: Date, targetDate: Date): boolean {
  const cacheDay = new Date(cacheDate.getFullYear(), cacheDate.getMonth(), cacheDate.getDate());
  const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  return cacheDay <= targetDay;
}

/**
 * Computes the default TTL for a cached query result (24 hours).
 * @param asOfDate - The as-of date of the result
 * @returns Expiry date
 */
export function computeDefaultExpiry(asOfDate: Date): Date {
  const d = new Date(asOfDate);
  d.setHours(d.getHours() + 24);
  return d;
}

/**
 * Service for time-versioned semantic query caching with hit analysis and proactive warming.
 */
export class TemporalQueryCache {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Stores a query result with a specific as-of date and optional TTL.
   * @param query - The query string
   * @param result - The result payload to cache
   * @param asOfDate - Semantic date of the result data
   * @param ttlMs - Cache TTL in milliseconds (default: 24h)
   * @returns The created cache entry id
   */
  async cacheQueryResult(
    query: string,
    result: unknown,
    asOfDate: Date,
    ttlMs = 24 * 60 * 60 * 1000,
  ): Promise<Result<string, Error>> {
    try {
      const normalized = normalizeQuery(query);
      const queryHash = hashQuery(normalized);
      const expiresAt = new Date(asOfDate.getTime() + ttlMs);

      const rows = await this.sql<{ id: string }[]>`
        INSERT INTO temporal_query_cache
          (query_hash, query_text, result_payload, as_of_date, expires_at)
        VALUES
          (${queryHash}, ${normalized}, ${JSON.stringify(result)}, ${asOfDate.toISOString()}, ${expiresAt.toISOString()})
        ON CONFLICT (query_hash, as_of_date)
        DO UPDATE SET
          result_payload = EXCLUDED.result_payload,
          expires_at = EXCLUDED.expires_at,
          hit_count = temporal_query_cache.hit_count,
          updated_at = NOW()
        RETURNING id
      `;

      const id = rows[0]?.id ?? '';
      log.debug('Cached query result', { queryHash, asOfDate, expiresAt });
      return ok(id);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieves a cached query result as of a specific date.
   * @param query - The query string
   * @param targetDate - The point-in-time date to retrieve for
   * @returns The cached result or null if not found
   */
  async queryAsOfDate(
    query: string,
    targetDate: Date,
  ): Promise<Result<CachedResult | null, Error>> {
    const start = Date.now();
    try {
      const normalized = normalizeQuery(query);
      const queryHash = hashQuery(normalized);

      const rows = await this.sql<CachedResult[]>`
        SELECT
          id AS "queryId",
          query_hash AS "queryHash",
          result_payload AS result,
          as_of_date AS "asOfDate",
          expires_at AS "expiresAt",
          hit_count AS "hitCount",
          created_at AS "createdAt"
        FROM temporal_query_cache
        WHERE query_hash = ${queryHash}
          AND as_of_date <= ${targetDate.toISOString()}
          AND expires_at > NOW()
        ORDER BY as_of_date DESC
        LIMIT 1
      `;

      const entry = rows[0] ?? null;
      const hit = entry !== null;
      const latencyMs = Date.now() - start;

      await this._recordHit(queryHash, hit, entry?.asOfDate ?? null, latencyMs, hit ? null : 'no_entry');

      if (hit) {
        await this.sql`
          UPDATE temporal_query_cache
          SET hit_count = hit_count + 1
          WHERE query_hash = ${queryHash}
            AND as_of_date = ${entry!.asOfDate.toISOString()}
        `;
      }

      return ok(entry);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Analyzes cache hit rates and miss patterns over a given interval.
   * @param intervalDays - Number of days to analyze (default: 7)
   * @returns Analytics summary with hit rate and miss patterns
   */
  async analyzeCacheHits(intervalDays = 7): Promise<Result<CacheAnalytics, Error>> {
    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - intervalDays);

      const [statsRows, missedRows, patternRows] = await Promise.all([
        this.sql<{ total: number; hits: number; misses: number }[]>`
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE hit = true) AS hits,
            COUNT(*) FILTER (WHERE hit = false) AS misses
          FROM cache_hit_analysis
          WHERE recorded_at >= ${sinceDate.toISOString()}
        `,
        this.sql<{ query_hash: string; miss_count: number; last_missed_at: Date }[]>`
          SELECT
            query_hash,
            COUNT(*) AS miss_count,
            MAX(recorded_at) AS last_missed_at
          FROM cache_hit_analysis
          WHERE hit = false
            AND recorded_at >= ${sinceDate.toISOString()}
          GROUP BY query_hash
          ORDER BY miss_count DESC
          LIMIT 10
        `,
        this.sql<{ miss_reason: string; cnt: number }[]>`
          SELECT miss_reason, COUNT(*) AS cnt
          FROM cache_hit_analysis
          WHERE hit = false
            AND miss_reason IS NOT NULL
            AND recorded_at >= ${sinceDate.toISOString()}
          GROUP BY miss_reason
          ORDER BY cnt DESC
        `,
      ]);

      const stats = statsRows[0] ?? { total: 0, hits: 0, misses: 0 };
      const totalRequests = Number(stats.total);
      const hitCount = Number(stats.hits);
      const missCount = Number(stats.misses);

      return ok({
        intervalDays,
        totalRequests,
        hitCount,
        missCount,
        hitRate: totalRequests === 0 ? 0 : hitCount / totalRequests,
        topMissedQueries: missedRows.map((r) => ({
          queryHash: r.query_hash,
          missCount: Number(r.miss_count),
          lastMissedAt: new Date(r.last_missed_at),
        })),
        missPatterns: patternRows.map((r) => ({
          reason: r.miss_reason,
          count: Number(r.cnt),
        })),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Identifies high-value queries and pre-caches them to improve hit rates.
   * @param intervalDays - Analysis window for identifying hot queries (default: 3)
   * @returns Number of queries warmed and skipped
   */
  async warmCacheProactively(intervalDays = 3): Promise<Result<WarmingResult, Error>> {
    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - intervalDays);

      // Find frequently accessed query hashes that have missed recently
      const candidates = await this.sql<{ query_hash: string; access_count: number; query_text: string }[]>`
        SELECT
          cha.query_hash,
          COUNT(*) AS access_count,
          tqc.query_text
        FROM cache_hit_analysis cha
        JOIN temporal_query_cache tqc ON tqc.query_hash = cha.query_hash
        WHERE cha.recorded_at >= ${sinceDate.toISOString()}
        GROUP BY cha.query_hash, tqc.query_text
        HAVING COUNT(*) >= 3
        ORDER BY access_count DESC
        LIMIT 50
      `;

      let warmed = 0;
      let skipped = 0;

      for (const candidate of candidates) {
        // Check if already cached for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const existing = await this.sql<{ id: string }[]>`
          SELECT id FROM temporal_query_cache
          WHERE query_hash = ${candidate.query_hash}
            AND as_of_date >= ${today.toISOString()}
            AND expires_at > NOW()
          LIMIT 1
        `;

        if (existing.length > 0) {
          skipped++;
        } else {
          // Record a warming event — actual re-execution happens via the caller
          await this.sql`
            INSERT INTO cache_warming_log (query_hash, query_text, warmed_at, access_count)
            VALUES (${candidate.query_hash}, ${candidate.query_text}, NOW(), ${candidate.access_count})
            ON CONFLICT (query_hash) DO UPDATE SET
              warmed_at = EXCLUDED.warmed_at,
              access_count = EXCLUDED.access_count
          `;
          warmed++;
        }
      }

      log.info('Cache warming complete', { warmed, skipped, candidates: candidates.length });

      return ok({
        warmed,
        skipped,
        candidates: candidates.map((c) => ({
          queryHash: c.query_hash,
          accessCount: Number(c.access_count),
        })),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Evicts expired cache entries older than the given cutoff.
   * @param olderThanDays - Evict entries expired more than this many days ago (default: 30)
   * @returns Number of evicted rows
   */
  async evictExpired(olderThanDays = 30): Promise<Result<number, Error>> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);

      const result = await this.sql`
        DELETE FROM temporal_query_cache
        WHERE expires_at < ${cutoff.toISOString()}
      `;

      const count = result.count ?? 0;
      log.info('Cache eviction complete', { evicted: count, olderThanDays });
      return ok(count);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async _recordHit(
    queryHash: string,
    hit: boolean,
    asOfDate: Date | null,
    latencyMs: number,
    missReason: string | null,
  ): Promise<void> {
    try {
      await this.sql`
        INSERT INTO cache_hit_analysis (query_hash, hit, as_of_date, latency_ms, miss_reason)
        VALUES (${queryHash}, ${hit}, ${asOfDate ? asOfDate.toISOString() : null}, ${latencyMs}, ${missReason})
      `;
    } catch {
      // Non-critical — don't fail the caller on analytics write errors
    }
  }
}
