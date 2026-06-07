import { createRequestContext } from '@iris/core/request-context';
import type { RequestContext } from '@iris/core/request-context';

const CORRELATION_ID_META_KEY = 'x-correlation-id';
const TRACE_ID_META_KEY = 'x-trace-id';

/**
 * Extract or create a RequestContext from MCP request metadata.
 * MCP callers can inject correlation IDs via request._meta to link
 * MCP tool spans back to the originating REST request.
 *
 * @param meta - Request metadata from the MCP call (optional)
 * @param workspaceId - Workspace associated with the MCP key
 */
export function extractContext(
  meta: Record<string, unknown> | undefined,
  workspaceId?: string,
): RequestContext {
  const incomingCorrelationId =
    meta ? (meta[CORRELATION_ID_META_KEY] as string | undefined) : undefined;

  return createRequestContext(undefined, workspaceId, incomingCorrelationId);
}

/**
 * Build metadata to forward to downstream MCP tool calls, propagating
 * the current trace context.
 *
 * @param ctx - Current request context
 */
export function buildPropagationMeta(ctx: RequestContext): Record<string, string> {
  return {
    [CORRELATION_ID_META_KEY]: ctx.correlationId,
    [TRACE_ID_META_KEY]: ctx.traceId,
  };
}
