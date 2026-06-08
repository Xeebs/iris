import { randomBytes } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'tracing' });

// ─── W3C TraceContext ─────────────────────────────────────────────────────────

export type TraceId = string; // 32 hex chars
export type SpanId = string;  // 16 hex chars

export type TraceContext = {
  traceId: TraceId;
  spanId: SpanId;
  parentSpanId: SpanId | null;
  sampled: boolean;
};

export type SpanStatus = 'ok' | 'error' | 'unset';

export type SpanData = {
  traceId: TraceId;
  spanId: SpanId;
  parentSpanId: SpanId | null;
  operationName: string;
  serviceName: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
};

export type SpanEvent = {
  name: string;
  timestamp: Date;
  attributes: Record<string, string | number | boolean>;
};

export type LatencyPercentiles = {
  p50: number;
  p95: number;
  p99: number;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Generate a new W3C-compliant trace ID (128-bit, 32 hex chars).
 */
export function generateTraceId(): TraceId {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a new span ID (64-bit, 16 hex chars).
 */
export function generateSpanId(): SpanId {
  return randomBytes(8).toString('hex');
}

/**
 * Parse a W3C traceparent header into a TraceContext.
 * Format: `00-<traceId>-<parentSpanId>-<flags>`
 */
export function parseTraceparent(header: string): TraceContext | null {
  const parts = header.split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, parentSpanId, flags] = parts;
  if (version !== '00') return null;
  if (!traceId || traceId.length !== 32) return null;
  if (!parentSpanId || parentSpanId.length !== 16) return null;
  const sampled = flags === '01';
  return { traceId, spanId: generateSpanId(), parentSpanId, sampled };
}

/**
 * Serialize a TraceContext into a W3C traceparent header value.
 */
export function serializeTraceparent(ctx: TraceContext): string {
  const flags = ctx.sampled ? '01' : '00';
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Create a new root TraceContext (no parent).
 */
export function newRootContext(sampled = true): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: null,
    sampled,
  };
}

/**
 * Create a child context inheriting the trace ID from a parent.
 */
export function childContext(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
    sampled: parent.sampled,
  };
}

/**
 * Compute latency percentiles from a sorted array of duration values.
 * Input must be sorted ascending.
 */
export function computePercentiles(sortedDurations: number[]): LatencyPercentiles {
  if (sortedDurations.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const at = (pct: number) => {
    const idx = Math.ceil((pct / 100) * sortedDurations.length) - 1;
    return sortedDurations[Math.max(0, idx)] ?? 0;
  };
  return { p50: at(50), p95: at(95), p99: at(99) };
}

/**
 * Strip PII-sensitive keys from span attributes before recording.
 * Keys containing 'email', 'phone', 'ssn', 'token', 'password' are redacted.
 */
export function sanitizeAttributes(
  attrs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const PII_PATTERNS = /email|phone|ssn|token|password|secret|key/i;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    out[k] = PII_PATTERNS.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

// ─── Active Span ──────────────────────────────────────────────────────────────

export class Span {
  private readonly data: SpanData;
  private readonly onEnd: (data: SpanData) => void;

  constructor(
    context: TraceContext,
    operationName: string,
    serviceName: string,
    attributes: Record<string, string | number | boolean>,
    onEnd: (data: SpanData) => void,
  ) {
    this.data = {
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      operationName,
      serviceName,
      startedAt: new Date(),
      endedAt: null,
      durationMs: null,
      status: 'unset',
      attributes: sanitizeAttributes(attributes),
      events: [],
    };
    this.onEnd = onEnd;
  }

  /** Record a milestone event within the span. */
  addEvent(name: string, attributes: Record<string, string | number | boolean> = {}): void {
    this.data.events.push({ name, timestamp: new Date(), attributes: sanitizeAttributes(attributes) });
  }

  /** Set span status (call before end). */
  setStatus(status: SpanStatus): void {
    this.data.status = status;
  }

  /** Merge additional attributes. */
  setAttributes(attrs: Record<string, string | number | boolean>): void {
    Object.assign(this.data.attributes, sanitizeAttributes(attrs));
  }

  /** Finish the span and hand off to the exporter. */
  end(status?: SpanStatus): void {
    if (this.data.endedAt) return; // idempotent
    if (status) this.data.status = status;
    if (this.data.status === 'unset') this.data.status = 'ok';
    this.data.endedAt = new Date();
    this.data.durationMs = this.data.endedAt.getTime() - this.data.startedAt.getTime();
    this.onEnd(this.data);
  }

  get context(): TraceContext {
    return {
      traceId: this.data.traceId,
      spanId: this.data.spanId,
      parentSpanId: this.data.parentSpanId,
      sampled: true,
    };
  }
}

// ─── TracingService ───────────────────────────────────────────────────────────

export class TracingService {
  private readonly serviceName: string;
  private readonly otlpEndpoint: string | null;

  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    serviceName: string,
    otlpEndpoint?: string,
  ) {
    this.serviceName = serviceName;
    this.otlpEndpoint = otlpEndpoint ?? null;
  }

  /**
   * Start a new root span (no incoming traceparent).
   */
  startSpan(
    operationName: string,
    attributes: Record<string, string | number | boolean> = {},
    parentContext?: TraceContext,
  ): Span {
    const ctx = parentContext ? childContext(parentContext) : newRootContext();
    return new Span(ctx, operationName, this.serviceName, attributes, (data) => {
      this.exportSpan(data).catch((e) => log.error('Span export failed', { error: String(e) }));
    });
  }

  /**
   * Parse incoming traceparent header and create a child span.
   */
  startSpanFromHeader(operationName: string, traceparentHeader: string | null): Span {
    const parent = traceparentHeader ? parseTraceparent(traceparentHeader) : null;
    return this.startSpan(operationName, {}, parent ?? undefined);
  }

  /**
   * Wrap an async function in a span. Sets status=error on exception.
   */
  async withSpan<T>(
    operationName: string,
    attributes: Record<string, string | number | boolean>,
    fn: (span: Span) => Promise<T>,
    parentContext?: TraceContext,
  ): Promise<T> {
    const span = this.startSpan(operationName, attributes, parentContext);
    try {
      const result = await fn(span);
      span.end('ok');
      return result;
    } catch (e) {
      span.setAttributes({ 'error.message': String(e) });
      span.end('error');
      throw e;
    }
  }

  /**
   * Query stored spans for a trace.
   */
  async getTrace(traceId: string): Promise<SpanData[]> {
    type Row = {
      span_id: string; parent_span_id: string | null; operation_name: string;
      service_name: string; started_at: Date; ended_at: Date | null;
      duration_ms: number | null; status: string;
      attributes: Record<string, string | number | boolean>;
      events: SpanEvent[];
    };
    const rows = await this.sql<Row[]>`
      SELECT span_id, parent_span_id, operation_name, service_name,
             started_at, ended_at, duration_ms, status, attributes, events
      FROM trace_spans
      WHERE trace_id = ${traceId}
      ORDER BY started_at ASC
    `;
    return rows.map((r) => ({
      traceId,
      spanId: r.span_id,
      parentSpanId: r.parent_span_id,
      operationName: r.operation_name,
      serviceName: r.service_name,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationMs: r.duration_ms,
      status: r.status as SpanStatus,
      attributes: r.attributes,
      events: r.events,
    }));
  }

  /**
   * Get recent traces for a workspace (last N, grouped by trace_id).
   */
  async listTraces(workspaceId: string, limit = 50): Promise<{ traceId: string; rootOperation: string; totalSpans: number; startedAt: Date; durationMs: number | null; status: SpanStatus }[]> {
    type Row = {
      trace_id: string; root_operation: string; total_spans: number;
      started_at: Date; duration_ms: number | null; status: string;
    };
    const rows = await this.sql<Row[]>`
      SELECT trace_id, MIN(operation_name) AS root_operation, COUNT(*) AS total_spans,
             MIN(started_at) AS started_at,
             CASE WHEN MAX(ended_at) IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (MAX(ended_at) - MIN(started_at))) * 1000
             END AS duration_ms,
             CASE WHEN SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) > 0
                  THEN 'error' ELSE 'ok'
             END AS status
      FROM trace_spans
      WHERE workspace_id = ${workspaceId}
      GROUP BY trace_id
      ORDER BY MIN(started_at) DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      traceId: r.trace_id,
      rootOperation: r.root_operation,
      totalSpans: Number(r.total_spans),
      startedAt: r.started_at,
      durationMs: r.duration_ms !== null ? Number(r.duration_ms) : null,
      status: r.status as SpanStatus,
    }));
  }

  /**
   * Get latency percentiles for an operation over a time window.
   */
  async getLatencyPercentiles(operationName: string, windowMs = 3_600_000): Promise<LatencyPercentiles> {
    type Row = { duration_ms: number };
    const since = new Date(Date.now() - windowMs);
    const rows = await this.sql<Row[]>`
      SELECT duration_ms FROM trace_spans
      WHERE operation_name = ${operationName}
        AND started_at > ${since.toISOString()}
        AND duration_ms IS NOT NULL
      ORDER BY duration_ms ASC
    `;
    return computePercentiles(rows.map((r) => Number(r.duration_ms)));
  }

  private async exportSpan(data: SpanData): Promise<void> {
    await this.sql`
      INSERT INTO trace_spans (
        trace_id, span_id, parent_span_id, operation_name, service_name,
        started_at, ended_at, duration_ms, status, attributes, events, workspace_id
      ) VALUES (
        ${data.traceId}, ${data.spanId}, ${data.parentSpanId},
        ${data.operationName}, ${data.serviceName},
        ${data.startedAt.toISOString()}, ${data.endedAt?.toISOString() ?? null},
        ${data.durationMs}, ${data.status},
        ${JSON.stringify(data.attributes)}, ${JSON.stringify(data.events)},
        ${'default'}
      )
      ON CONFLICT (trace_id, span_id) DO NOTHING
    `;

    if (this.otlpEndpoint) {
      log.debug('OTLP export', { traceId: data.traceId, operationName: data.operationName });
    }
  }
}
