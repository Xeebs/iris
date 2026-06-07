import { randomBytes } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RequestContext = {
  correlationId: string;
  traceId: string;
  spanId: string;
  userId: string | null;
  workspaceId: string | null;
  startTime: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a new request context with fresh IDs.
 *
 * @param userId - Optional authenticated user ID
 * @param workspaceId - Optional tenant workspace ID
 * @param correlationId - Use incoming header value if present; otherwise generate a new one
 */
export function createRequestContext(
  userId?: string,
  workspaceId?: string,
  correlationId?: string,
): RequestContext {
  return {
    correlationId: correlationId ?? randomBytes(12).toString('hex'),
    traceId: randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    userId: userId ?? null,
    workspaceId: workspaceId ?? null,
    startTime: Date.now(),
  };
}

/**
 * Merge request context into a log metadata object.
 * Use this when calling logger.info / logger.error to attach trace context.
 *
 * @param ctx - Current request context
 * @param extra - Additional metadata fields
 */
export function contextMeta(
  ctx: RequestContext,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    correlationId: ctx.correlationId,
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    ...extra,
  };
}

/**
 * Compute elapsed milliseconds since the context was created.
 *
 * @param ctx - The request context
 */
export function elapsedMs(ctx: RequestContext): number {
  return Date.now() - ctx.startTime;
}
