import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';
import { randomBytes } from 'node:crypto';

export type SpanStatus = 'ok' | 'error' | 'timeout';

export type Span = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  durationMs: number | null;
  status: SpanStatus;
  metadata: Record<string, unknown>;
  errors: unknown[] | null;
  startedAt: Date;
  endedAt: Date | null;
  workspaceId: string | null;
};

export type TraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
};

export type TraceAnalysis = {
  traceId: string;
  totalSpans: number;
  totalDurationMs: number;
  criticalPath: string[];
  slowestOperations: Array<{ operationName: string; durationMs: number }>;
  errorCount: number;
};

const W3C_TRACEPARENT = 'traceparent';
const TRACEPARENT_VERSION = '00';

/**
 * W3C TraceContext-compliant distributed request tracer.
 * Propagates trace IDs across HTTP boundaries, records spans, and
 * publishes trace data to Postgres for cross-service correlation.
 */
export class RequestTracer {
  constructor(
    private readonly sql: Sql,
    private readonly serviceName: string = 'api'
  ) {}

  /**
   * Generates a new 16-byte hex trace ID.
   *
   * @returns A random W3C-compliant 32-char hex trace ID
   */
  generateTraceId(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Generates a new 8-byte hex span ID.
   *
   * @returns A random W3C-compliant 16-char hex span ID
   */
  generateSpanId(): string {
    return randomBytes(8).toString('hex');
  }

  /**
   * Creates a new span context linked to a parent span.
   *
   * @param traceId - Trace to participate in (or null to start new trace)
   * @param parentSpanId - Parent span this span is a child of
   * @param operation - Human-readable operation name (e.g. 'api.query-context')
   * @returns New TraceContext for propagation
   */
  propagateTraceContext(
    traceId: string | null,
    parentSpanId: string | null,
    operation: string
  ): TraceContext & { operationName: string } {
    return {
      traceId: traceId ?? this.generateTraceId(),
      spanId: this.generateSpanId(),
      parentSpanId,
      operationName: operation,
    };
  }

  /**
   * Records a completed span to persistent storage.
   *
   * @param span - Completed span with timing and metadata
   */
  async recordSpan(span: Span): Promise<void> {
    await this.sql`
      INSERT INTO request_traces
        (trace_id, span_id, parent_span_id, operation_name, service_name,
         duration_ms, status, metadata, errors, started_at, ended_at, workspace_id)
      VALUES
        (${span.traceId}, ${span.spanId}, ${span.parentSpanId ?? null},
         ${span.operationName}, ${span.serviceName},
         ${span.durationMs ?? null}, ${span.status},
         ${JSON.stringify(span.metadata)}::jsonb,
         ${span.errors ? JSON.stringify(span.errors) : null}::jsonb,
         ${span.startedAt}, ${span.endedAt ?? null}, ${span.workspaceId ?? null})
      ON CONFLICT (trace_id, span_id) DO NOTHING
    `;

    logger.debug('Span recorded', {
      traceId: span.traceId,
      spanId: span.spanId,
      operation: span.operationName,
      durationMs: span.durationMs,
      status: span.status,
    });
  }

  /**
   * Parses a W3C traceparent header into a TraceContext.
   * Returns null if the header is missing or malformed.
   *
   * @param headers - HTTP request headers map
   * @returns Parsed TraceContext or null
   */
  extractTraceFromHeaders(headers: Record<string, string | string[] | undefined>): TraceContext | null {
    const raw = headers[W3C_TRACEPARENT];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;

    const parts = value.split('-');
    if (parts.length !== 4) return null;
    const [version, traceId, spanId] = parts;
    if (version !== TRACEPARENT_VERSION) return null;
    if (!traceId || traceId.length !== 32) return null;
    if (!spanId || spanId.length !== 16) return null;

    return { traceId, spanId, parentSpanId: spanId };
  }

  /**
   * Injects W3C traceparent header into an outgoing request's headers.
   *
   * @param context - Active trace context to propagate
   * @returns Headers object with traceparent injected
   */
  injectTraceIntoHeaders(context: TraceContext): Record<string, string> {
    const traceparent = `${TRACEPARENT_VERSION}-${context.traceId}-${context.spanId}-01`;
    return { [W3C_TRACEPARENT]: traceparent };
  }

  /**
   * Retrieves all spans for a trace, ordered by start time.
   *
   * @param traceId - Trace to retrieve
   * @returns Ordered list of spans
   */
  async getTrace(traceId: string): Promise<Span[]> {
    const rows = await this.sql<Span[]>`
      SELECT trace_id, span_id, parent_span_id, operation_name, service_name,
             duration_ms, status, metadata, errors, started_at, ended_at, workspace_id
      FROM request_traces
      WHERE trace_id = ${traceId}
      ORDER BY started_at ASC
    `;
    return rows;
  }

  /**
   * Searches recent traces by operation name, optionally scoped to workspace.
   *
   * @param operationName - Substring match against operation_name
   * @param workspaceId - Optional workspace filter
   * @param limit - Max results
   * @param cursor - ISO timestamp for pagination cursor
   */
  async searchTraces(
    operationName: string | null,
    workspaceId: string | null,
    limit = 50,
    cursor?: string
  ): Promise<{ spans: Span[]; nextCursor: string | null }> {
    const cutoff = cursor ? new Date(cursor) : new Date(Date.now() + 1000);

    const rows = await this.sql<Span[]>`
      SELECT DISTINCT ON (trace_id) trace_id, span_id, parent_span_id,
             operation_name, service_name, duration_ms, status,
             metadata, errors, started_at, ended_at, workspace_id
      FROM request_traces
      WHERE started_at < ${cutoff}
        AND (${operationName}::text IS NULL OR operation_name ILIKE ${'%' + (operationName ?? '') + '%'})
        AND (${workspaceId}::text IS NULL OR workspace_id = ${workspaceId})
      ORDER BY trace_id, started_at DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const results = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? results[results.length - 1]!.startedAt.toISOString() : null;

    return { spans: results, nextCursor };
  }

  /**
   * Analyzes a trace to identify critical path and slow operations.
   *
   * @param traceId - Trace to analyze
   * @returns Analysis including critical path and slowest operations
   */
  async analyzeTrace(traceId: string): Promise<TraceAnalysis> {
    const spans = await this.getTrace(traceId);

    if (spans.length === 0) {
      return {
        traceId,
        totalSpans: 0,
        totalDurationMs: 0,
        criticalPath: [],
        slowestOperations: [],
        errorCount: 0,
      };
    }

    const totalDurationMs = spans.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    const errorCount = spans.filter((s) => s.status !== 'ok').length;

    const sorted = [...spans]
      .filter((s) => s.durationMs !== null)
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));

    const slowestOperations = sorted.slice(0, 5).map((s) => ({
      operationName: s.operationName,
      durationMs: s.durationMs ?? 0,
    }));

    const criticalPath = buildCriticalPath(spans);

    return {
      traceId,
      totalSpans: spans.length,
      totalDurationMs,
      criticalPath,
      slowestOperations,
      errorCount,
    };
  }

  /**
   * Publishes a batch of spans to the backend storage.
   *
   * @param traceId - Trace these spans belong to
   * @param spans - Spans to persist
   */
  async publishTraceToBackend(traceId: string, spans: Span[]): Promise<void> {
    for (const span of spans) {
      await this.recordSpan(span);
    }
    logger.info('Trace published', { traceId, spanCount: spans.length, service: this.serviceName });
  }
}

function buildCriticalPath(spans: Span[]): string[] {
  if (spans.length === 0) return [];

  const spanMap = new Map<string, Span>(spans.map((s) => [s.spanId, s]));
  const childrenOf = new Map<string | null, string[]>();

  for (const s of spans) {
    const parentKey = s.parentSpanId ?? null;
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
    childrenOf.get(parentKey)!.push(s.spanId);
  }

  const roots = childrenOf.get(null) ?? [];
  if (roots.length === 0) return spans.map((s) => s.operationName);

  const path: string[] = [];
  let current = roots[0];

  while (current) {
    const span = spanMap.get(current);
    if (!span) break;
    path.push(span.operationName);
    const children = childrenOf.get(current) ?? [];
    current = children.length > 0 ? children[0] : undefined;
  }

  return path;
}
