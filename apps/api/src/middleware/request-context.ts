import type { MiddlewareHandler } from 'hono';

import { createRequestContext } from '@iris/core/request-context';
import { logger } from '@iris/core/logger';

const log = logger.child({ middleware: 'request-context' });

const CORRELATION_ID_HEADER = 'X-Correlation-ID';
const TRACE_ID_HEADER = 'X-Trace-ID';

/**
 * Hono middleware that attaches a RequestContext to every incoming request.
 * Extracts or generates a correlationId, logs request start, and adds
 * trace headers to the response.
 */
export const requestContextMiddleware: MiddlewareHandler = async (c, next) => {
  const incomingCorrelationId = c.req.header(CORRELATION_ID_HEADER);
  const workspaceId = c.get('workspaceId') as string | undefined;

  const ctx = createRequestContext(
    undefined,
    workspaceId,
    incomingCorrelationId,
  );

  c.set('requestContext', ctx);

  log.debug('Request started', {
    correlationId: ctx.correlationId,
    traceId: ctx.traceId,
    method: c.req.method,
    path: c.req.path,
  });

  c.header(CORRELATION_ID_HEADER, ctx.correlationId);
  c.header(TRACE_ID_HEADER, ctx.traceId);

  await next();

  const statusCode = c.res.status;
  const durationMs = Date.now() - ctx.startTime;

  log.info('Request completed', {
    correlationId: ctx.correlationId,
    traceId: ctx.traceId,
    method: c.req.method,
    path: c.req.path,
    statusCode,
    durationMs,
  });
};
