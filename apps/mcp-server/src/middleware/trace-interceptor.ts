import type { Sql } from 'postgres';
import { RequestTracer } from '@iris/semantic-core/request-tracer';
import { logger } from '@iris/core/logger';

/**
 * Wraps an MCP tool handler to record a span for every tool call.
 *
 * @param tracer - RequestTracer instance
 * @param toolName - MCP tool name for the span operation label
 * @param handler - Original tool handler
 * @param workspaceId - Workspace context for span attribution
 * @returns Wrapped handler that records a span
 */
export function withTracing<TInput, TOutput>(
  tracer: RequestTracer,
  toolName: string,
  handler: (input: TInput) => Promise<TOutput>,
  workspaceId?: string
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput): Promise<TOutput> => {
    const ctx = tracer.propagateTraceContext(null, null, `mcp.${toolName}`);
    const startedAt = new Date();

    try {
      const result = await handler(input);
      const endedAt = new Date();

      await tracer.recordSpan({
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        parentSpanId: null,
        operationName: ctx.operationName,
        serviceName: 'mcp-server',
        durationMs: endedAt.getTime() - startedAt.getTime(),
        status: 'ok',
        metadata: { toolName, input: JSON.stringify(input).slice(0, 500) },
        errors: null,
        startedAt,
        endedAt,
        workspaceId: workspaceId ?? null,
      });

      return result;
    } catch (e) {
      const endedAt = new Date();

      await tracer.recordSpan({
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        parentSpanId: null,
        operationName: ctx.operationName,
        serviceName: 'mcp-server',
        durationMs: endedAt.getTime() - startedAt.getTime(),
        status: 'error',
        metadata: { toolName },
        errors: [e instanceof Error ? e.message : String(e)],
        startedAt,
        endedAt,
        workspaceId: workspaceId ?? null,
      }).catch((persistErr) => {
        logger.warn('Failed to persist error span', { toolName, error: persistErr });
      });

      throw e;
    }
  };
}

/**
 * Creates a RequestTracer bound to a SQL client for use in the MCP server.
 *
 * @param sql - Postgres client
 */
export function createMcpTracer(sql: Sql): RequestTracer {
  return new RequestTracer(sql, 'mcp-server');
}
