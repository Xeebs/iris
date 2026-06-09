import type { Context, Next } from 'hono';
import { logger } from '@iris/core/logger';

type ApiError = { code: string; message: string; details?: unknown };

/**
 * Hono middleware that catches unhandled errors and emits structured API error responses.
 * Wraps errors from resilience-middleware failures, circuit breakers, and upstream services.
 */
export async function errorHandlerResilience(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
  } catch (err) {
    const correlationId = c.req.header('x-correlation-id') ?? crypto.randomUUID();

    logger.error('Unhandled error in request', {
      correlationId,
      path: c.req.path,
      method: c.req.method,
      error: err instanceof Error ? err.message : String(err),
    });

    const apiError = mapToApiError(err);

    return c.json(
      { error: { ...apiError, correlationId } },
      statusCodeFor(apiError.code),
    );
  }
}

function mapToApiError(err: unknown): ApiError {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return { code: 'UPSTREAM_TIMEOUT', message: 'The upstream service did not respond in time.' };
    }
    if (msg.includes('circuit') || msg.includes('open')) {
      return { code: 'SERVICE_UNAVAILABLE', message: 'Service is temporarily unavailable. Please retry shortly.' };
    }
    if (msg.includes('rate limit') || msg.includes('429')) {
      return { code: 'RATE_LIMITED', message: 'Rate limit reached. Slow down and retry.' };
    }
    if (msg.includes('unauthorized') || msg.includes('401')) {
      return { code: 'UNAUTHORIZED', message: 'Authentication required.' };
    }
    if (msg.includes('forbidden') || msg.includes('403')) {
      return { code: 'FORBIDDEN', message: 'You do not have permission to access this resource.' };
    }
    return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
  }
  return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
}

function statusCodeFor(code: string): 400 | 401 | 403 | 429 | 500 | 502 | 503 {
  switch (code) {
    case 'UPSTREAM_TIMEOUT': return 502;
    case 'SERVICE_UNAVAILABLE': return 503;
    case 'RATE_LIMITED': return 429;
    case 'UNAUTHORIZED': return 401;
    case 'FORBIDDEN': return 403;
    default: return 500;
  }
}
