import type { Redis } from 'ioredis';
import { getAuth } from '@hono/clerk-auth';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'rate-limiter' });

export type RateLimiterOptions = {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Sliding window duration in milliseconds */
  windowMs: number;
  /** Key suffix to distinguish different limit tiers (e.g., 'default', 'sync') */
  keyScope?: string;
};

const DEFAULT_LIMIT = Number(process.env['RATE_LIMIT_DEFAULT'] ?? 100);
const DEFAULT_WINDOW_MS = 60_000;
const SYNC_LIMIT = Number(process.env['RATE_LIMIT_SYNC'] ?? 10);

/**
 * Sliding-window rate limiter backed by Redis sorted sets.
 *
 * Each workspace gets its own sorted set keyed by `rate:{scope}:{userId}`.
 * Entries older than `windowMs` are pruned on each check.
 *
 * @param redis - Connected ioredis client
 * @param options - Limit configuration
 */
export function createRateLimiter(
  redis: Redis,
  options: RateLimiterOptions = { limit: DEFAULT_LIMIT, windowMs: DEFAULT_WINDOW_MS },
): MiddlewareHandler {
  const { limit, windowMs, keyScope = 'default' } = options;

  return createMiddleware(async (c, next) => {
    const auth = getAuth(c);
    const userId = auth?.userId;

    if (!userId) {
      // Auth guard runs before rate limiter; treat missing user as unauthenticated.
      return next();
    }

    const key = `rate:${keyScope}:${userId}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const pipeline = redis.pipeline();
      // Remove expired entries
      pipeline.zremrangebyscore(key, 0, windowStart);
      // Count remaining entries
      pipeline.zcard(key);
      // Add current request (member = timestamp + random suffix for uniqueness)
      pipeline.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
      // Set TTL so the key self-expires
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();

      // results[1] is zcard result — [error, count]
      const cardResult = results?.[1];
      const count = cardResult?.[1] as number | null;

      if (count !== null && count >= limit) {
        const retryAfterSeconds = Math.ceil(windowMs / 1000);
        log.warn('Rate limit exceeded', { userId, keyScope, count, limit });
        return c.json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: `Too many requests. Limit: ${limit} per ${retryAfterSeconds}s. Retry after ${retryAfterSeconds}s.`,
            },
          },
          429,
          { 'Retry-After': String(retryAfterSeconds) },
        );
      }
    } catch (e) {
      // Redis failure — fail open (don't block requests)
      log.error('Rate limiter Redis error — failing open', { error: e, userId });
    }

    return next();
  });
}

/**
 * Global default rate limiter: 100 requests/minute per user.
 * Intended to be registered on all authenticated routes.
 *
 * @param redis - Connected ioredis client
 */
export function defaultRateLimiter(redis: Redis): MiddlewareHandler {
  return createRateLimiter(redis, {
    limit: DEFAULT_LIMIT,
    windowMs: DEFAULT_WINDOW_MS,
    keyScope: 'default',
  });
}

/**
 * Stricter rate limiter for sync trigger endpoints: 10 requests/minute per user.
 *
 * @param redis - Connected ioredis client
 */
export function syncRateLimiter(redis: Redis): MiddlewareHandler {
  return createRateLimiter(redis, {
    limit: SYNC_LIMIT,
    windowMs: DEFAULT_WINDOW_MS,
    keyScope: 'sync',
  });
}
