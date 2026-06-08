import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ service: 'rate-limiter' });

export type TierName = 'free' | 'pro' | 'enterprise';

export const TIER_LIMITS: Record<TierName, { requestsPerMinute: number; requestsPerDay: number; mcpCallsPerHour: number }> = {
  free:       { requestsPerMinute: 30,   requestsPerDay: 1_000,  mcpCallsPerHour: 100 },
  pro:        { requestsPerMinute: 300,  requestsPerDay: 50_000, mcpCallsPerHour: 2_000 },
  enterprise: { requestsPerMinute: 3000, requestsPerDay: 500_000, mcpCallsPerHour: 20_000 },
};

export type QuotaStatus = {
  workspaceId: string;
  tier: TierName;
  requestsThisMinute: number;
  requestsToday: number;
  mcpCallsThisHour: number;
  limits: typeof TIER_LIMITS[TierName];
  rateLimited: boolean;
  retryAfterMs: number | null;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number | null;
  remaining: number;
};

/**
 * Compute sliding window count using bucket-based approximation.
 * Blends the previous bucket's count (weighted by overlap) with the current bucket count.
 * @param prevCount - Request count in previous window
 * @param currCount - Request count in current window so far
 * @param windowMs - Window duration in milliseconds
 * @param nowMs - Current timestamp in ms
 */
export function slidingWindowCount(prevCount: number, currCount: number, windowMs: number, nowMs: number): number {
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const elapsedInWindow = nowMs - windowStart;
  const prevWeight = 1 - elapsedInWindow / windowMs;
  return Math.floor(prevCount * prevWeight) + currCount;
}

/**
 * Sliding window rate limiter backed by Postgres for durability.
 * Suitable for API rate limits; not Redis-hot-path fast but acceptable for per-request checks.
 */
export class RateLimitService {
  private readonly sql: SqlFn;

  constructor(sql: SqlFn) {
    this.sql = sql;
  }

  /**
   * Check and increment the rate limit counter for a workspace+endpoint.
   * @param workspaceId - Workspace identifier
   * @param endpoint - Endpoint bucket (e.g. "api", "mcp")
   * @param limitPerWindow - Max allowed requests per window
   * @param windowMs - Window size in ms (e.g. 60_000 for 1 minute)
   */
  async enforceRateLimit(
    workspaceId: string,
    endpoint: string,
    limitPerWindow: number,
    windowMs: number,
  ): Promise<Result<RateLimitResult, Error>> {
    const nowMs = Date.now();
    const windowKey = Math.floor(nowMs / windowMs);
    const prevWindowKey = windowKey - 1;

    try {
      const rows = await this.sql`
        SELECT window_key, request_count
        FROM quota_usage
        WHERE workspace_id = ${workspaceId}
          AND endpoint = ${endpoint}
          AND window_key IN (${windowKey}, ${prevWindowKey})
      ` as unknown as Array<{ window_key: number; request_count: number }>;

      const curr = rows.find(r => r.window_key === windowKey)?.request_count ?? 0;
      const prev = rows.find(r => r.window_key === prevWindowKey)?.request_count ?? 0;
      const effective = slidingWindowCount(prev, curr, windowMs, nowMs);

      if (effective >= limitPerWindow) {
        const windowEnd = (windowKey + 1) * windowMs;
        const retryAfterMs = windowEnd - nowMs;
        log.warn('Rate limit exceeded', { workspaceId, endpoint, effective, limit: limitPerWindow });
        return ok({ allowed: false, retryAfterMs, remaining: 0 });
      }

      // Increment current window
      await this.sql`
        INSERT INTO quota_usage (workspace_id, endpoint, window_key, window_ms, request_count)
        VALUES (${workspaceId}, ${endpoint}, ${windowKey}, ${windowMs}, 1)
        ON CONFLICT (workspace_id, endpoint, window_key)
        DO UPDATE SET request_count = quota_usage.request_count + 1
      `;

      return ok({ allowed: true, retryAfterMs: null, remaining: limitPerWindow - effective - 1 });
    } catch (e) {
      log.error('Rate limit check failed', { workspaceId, error: e instanceof Error ? e.message : e });
      // Fail open — don't block requests when rate limiting itself fails
      return ok({ allowed: true, retryAfterMs: null, remaining: limitPerWindow });
    }
  }

  /**
   * Retrieve current quota usage and limits for a workspace.
   * @param workspaceId - Workspace identifier
   */
  async getQuotaStatus(workspaceId: string): Promise<Result<QuotaStatus, Error>> {
    const nowMs = Date.now();

    try {
      const configRows = await this.sql`
        SELECT tier FROM rate_limit_configs
        WHERE workspace_id = ${workspaceId}
        LIMIT 1
      ` as unknown as Array<{ tier: string }>;

      const tier = (configRows[0]?.tier ?? 'free') as TierName;
      const limits = TIER_LIMITS[tier];

      const minuteWindowKey = Math.floor(nowMs / 60_000);
      const hourWindowKey = Math.floor(nowMs / 3_600_000);
      const dayWindowKey = Math.floor(nowMs / 86_400_000);

      const usageRows = await this.sql`
        SELECT endpoint, window_key, window_ms, request_count
        FROM quota_usage
        WHERE workspace_id = ${workspaceId}
          AND window_key IN (${minuteWindowKey}, ${hourWindowKey}, ${dayWindowKey})
      ` as unknown as Array<{ endpoint: string; window_key: number; window_ms: number; request_count: number }>;

      const minuteCount = usageRows.filter(r => r.window_key === minuteWindowKey && r.window_ms === 60_000).reduce((s, r) => s + r.request_count, 0);
      const hourCount = usageRows.filter(r => r.window_key === hourWindowKey && r.endpoint === 'mcp').reduce((s, r) => s + r.request_count, 0);
      const dayCount = usageRows.filter(r => r.window_key === dayWindowKey && r.window_ms === 86_400_000).reduce((s, r) => s + r.request_count, 0);

      const rateLimited = minuteCount >= limits.requestsPerMinute || dayCount >= limits.requestsPerDay;

      return ok({
        workspaceId, tier, limits,
        requestsThisMinute: minuteCount,
        requestsToday: dayCount,
        mcpCallsThisHour: hourCount,
        rateLimited,
        retryAfterMs: rateLimited ? 60_000 - (nowMs % 60_000) : null,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Set or update the rate limit tier for a workspace.
   * @param workspaceId - Workspace identifier
   * @param tier - Tier name
   */
  async setTier(workspaceId: string, tier: TierName): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO rate_limit_configs (workspace_id, tier)
        VALUES (${workspaceId}, ${tier})
        ON CONFLICT (workspace_id)
        DO UPDATE SET tier = EXCLUDED.tier, updated_at = now()
      `;
      log.info('Workspace tier updated', { workspaceId, tier });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Prune old quota usage buckets to keep the table lean.
   * @param olderThanDays - Delete buckets older than this many days (default 2)
   */
  async pruneOldBuckets(olderThanDays = 2): Promise<Result<number, Error>> {
    const cutoffWindowKey = Math.floor(Date.now() / 60_000) - olderThanDays * 24 * 60;
    try {
      const rows = await this.sql`
        DELETE FROM quota_usage
        WHERE window_key < ${cutoffWindowKey}
        RETURNING 1
      ` as unknown as Array<unknown>;
      return ok(rows.length);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
