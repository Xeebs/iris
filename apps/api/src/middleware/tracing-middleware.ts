import type { Context, Next } from 'hono';
import { parseTraceparent, serializeTraceparent, newRootContext, childContext } from '@iris/semantic-core/tracing';

/**
 * Hono middleware that reads W3C traceparent from incoming request, creates or
 * continues a trace context, and injects traceparent/tracestate into the
 * response headers.
 */
export async function tracingMiddleware(c: Context, next: Next) {
  const incomingHeader = c.req.header('traceparent') ?? null;
  const parent = incomingHeader ? parseTraceparent(incomingHeader) : null;
  const ctx = parent ? childContext(parent) : newRootContext();

  c.set('traceContext', ctx);
  c.header('traceparent', serializeTraceparent(ctx));

  await next();
}
