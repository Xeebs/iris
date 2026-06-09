import type { Context, MiddlewareHandler, Next } from 'hono';
import { RateLimitService, TIER_LIMITS } from '@iris/semantic-core/rate-limiter';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

type RateLimitOptions = {
  windowMs?: number;
  limitPerWindow?: number;
  endpoint?: string;
};

/**
 * Hono middleware that enforces workspace-level rate limits.
 * Reads workspace ID from X-Workspace-Id header.
 * Returns 429 with Retry-After header when limit is exceeded.
 */
export function rateLimitMiddleware(
  sql: SqlFn,
  options: RateLimitOptions = {},
): MiddlewareHandler {
  const {
    windowMs = 60_000,
    endpoint = 'api',
    limitPerWindow = TIER_LIMITS['free'].requestsPerMinute,
  } = options;

  const svc = new RateLimitService(sql);

  return async (c: Context, next: Next) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';

    const result = await svc.enforceRateLimit(workspaceId, endpoint, limitPerWindow, windowMs);

    if (result.isOk()) {
      const { allowed, retryAfterMs, remaining } = result.value;
      c.header('X-RateLimit-Limit', String(limitPerWindow));
      c.header('X-RateLimit-Remaining', String(remaining));

      if (!allowed && retryAfterMs !== null) {
        c.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
        return c.json(
          { error: { code: 'rate_limited', message: 'Too many requests. Please retry after the indicated delay.' } },
          429,
        );
      }
    }

    await next();
    return;
  };
}
