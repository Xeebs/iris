import type { Context, Next } from 'hono';
import type { Sql } from 'postgres';
import { RequestTracer } from '@iris/semantic-core/request-tracer';
import { logger } from '@iris/core/logger';

/**
 * Hono middleware that injects/extracts W3C TraceContext on every request
 * and records a root span when the response completes.
 *
 * @param sql - Postgres client for span persistence
 * @param serviceName - Service identifier for span attribution
 */
export function requestTracingMiddleware(sql: Sql, serviceName = 'api') {
  const tracer = new RequestTracer(sql, serviceName);

  return async (c: Context, next: Next) => {
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(c.req.header())) {
      headers[k.toLowerCase()] = v;
    }

    const incoming = tracer.extractTraceFromHeaders(headers);
    const ctx = tracer.propagateTraceContext(
      incoming?.traceId ?? null,
      incoming?.spanId ?? null,
      `${c.req.method} ${c.req.path}`
    );

    c.set('traceId', ctx.traceId);
    c.set('spanId', ctx.spanId);

    const startedAt = new Date();

    await next();

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();
    const status = c.res.status >= 500 ? 'error' : c.res.status === 0 ? 'timeout' : 'ok';

    try {
      await tracer.recordSpan({
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        parentSpanId: ctx.parentSpanId,
        operationName: ctx.operationName,
        serviceName,
        durationMs,
        status: status as 'ok' | 'error' | 'timeout',
        metadata: {
          method: c.req.method,
          path: c.req.path,
          statusCode: c.res.status,
        },
        errors: null,
        startedAt,
        endedAt,
        workspaceId: (c.get('workspaceId') as string | undefined) ?? null,
      });
    } catch (e) {
      logger.warn('Failed to record request span', {
        traceId: ctx.traceId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    c.header('traceparent', `00-${ctx.traceId}-${ctx.spanId}-01`);
  };
}
