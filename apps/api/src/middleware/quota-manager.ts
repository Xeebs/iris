/**
 * Token-bucket quota manager with burst capacity.
 *
 * Unlike the sliding-window rate-limiter, the quota manager supports burst
 * capacity by accumulating unused quota when a resource is idle, up to a
 * configurable burst multiplier.
 *
 * Stored in Redis: `quota:{scope}:{userId}` → `tokens:lastRefillMs`
 * Atomicity is guaranteed via a Lua script.
 */

import type { Redis } from 'ioredis';
import { getAuth } from '@hono/clerk-auth';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'quota-manager' });

export type QuotaOptions = {
  /** Base quota per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Maximum burst multiplier (e.g. 1.5 allows up to limit * 1.5 tokens) */
  burstMultiplier?: number;
  /** Key scope to distinguish quota dimensions */
  scope: string;
};

/** Lua script for atomic token-bucket check-and-consume. */
const BUCKET_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local burst_limit = tonumber(ARGV[2])
local rate = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])

local data = redis.call('GET', key)
local tokens, last_refill
if data then
  local sep = string.find(data, ':')
  tokens = tonumber(string.sub(data, 1, sep - 1))
  last_refill = tonumber(string.sub(data, sep + 1))
else
  tokens = burst_limit
  last_refill = now
end

local elapsed = math.max(0, now - last_refill)
tokens = math.min(burst_limit, tokens + elapsed * rate)

if tokens < 1 then
  redis.call('SET', key, tokens .. ':' .. now, 'PX', ttl_ms)
  return {0, math.floor(tokens), math.ceil((1 - tokens) / rate)}
end

tokens = tokens - 1
redis.call('SET', key, tokens .. ':' .. now, 'PX', ttl_ms)
return {1, math.floor(tokens), 0}
`;

/**
 * Create a token-bucket quota middleware.
 *
 * @param redis   - Connected ioredis client
 * @param options - Quota configuration
 */
export function createQuotaMiddleware(redis: Redis, options: QuotaOptions): MiddlewareHandler {
  const { limit, windowMs, burstMultiplier = 1.5, scope } = options;
  const burstLimit = limit * burstMultiplier;
  // Rate of token replenishment per millisecond
  const rate = limit / windowMs;
  // Key TTL: 2× the window so stale keys self-expire
  const ttlMs = windowMs * 2;

  return createMiddleware(async (c, next) => {
    const auth = getAuth(c);
    const userId = auth?.userId;

    if (!userId) return next();

    const key = `quota:${scope}:${userId}`;
    const now = Date.now();

    try {
      const result = await redis.eval(
        BUCKET_SCRIPT,
        1,
        key,
        String(limit),
        String(burstLimit),
        String(rate),
        String(now),
        String(ttlMs),
      ) as [number, number, number];

      const [allowed, remaining, retryAfterMs] = result;

      c.header('X-RateLimit-Limit', String(limit));
      c.header('X-RateLimit-Remaining', String(Math.max(0, remaining)));
      c.header('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

      if (!allowed) {
        const retryAfterSec = Math.ceil(retryAfterMs / 1000) + 1;
        c.header('Retry-After', String(retryAfterSec));
        log.warn('Quota exceeded', { userId, scope, remaining });
        return c.json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: `Quota exceeded for ${scope}. Retry after ${retryAfterSec}s.`,
            },
          },
          429,
        );
      }
    } catch (e) {
      log.error('Quota manager Redis error — failing open', { error: e, userId, scope });
    }

    return next();
  });
}

/** Sync trigger quota: 10 per minute with 1.5× burst (up to 15). */
export function syncQuota(redis: Redis): MiddlewareHandler {
  return createQuotaMiddleware(redis, {
    limit: Number(process.env['QUOTA_SYNC_LIMIT'] ?? 10),
    windowMs: 60_000,
    scope: 'sync',
  });
}

/** Webhook event quota: 100 per minute with 1.5× burst. */
export function webhookQuota(redis: Redis): MiddlewareHandler {
  return createQuotaMiddleware(redis, {
    limit: Number(process.env['QUOTA_WEBHOOK_LIMIT'] ?? 100),
    windowMs: 60_000,
    scope: 'webhook',
  });
}
