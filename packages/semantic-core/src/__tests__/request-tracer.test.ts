import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestTracer, type Span, type TraceContext } from '../request-tracer.js';

function makeSql(responses: Record<string, unknown[]> = {}) {
  return vi.fn((strings: TemplateStringsArray) => {
    const q = strings.raw.join('?');
    for (const [key, rows] of Object.entries(responses)) {
      if (q.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
}

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    parentSpanId: null,
    operationName: 'api.test',
    serviceName: 'api',
    durationMs: 42,
    status: 'ok',
    metadata: {},
    errors: null,
    startedAt: new Date(),
    endedAt: new Date(),
    workspaceId: 'ws1',
    ...overrides,
  };
}

describe('RequestTracer', () => {
  let sql: ReturnType<typeof makeSql>;
  let tracer: RequestTracer;

  beforeEach(() => {
    sql = makeSql();
    tracer = new RequestTracer(sql as unknown as ReturnType<typeof import('postgres').default>);
  });

  describe('generateTraceId', () => {
    it('generates a 32-char hex string', () => {
      const id = tracer.generateTraceId();
      expect(id).toHaveLength(32);
      expect(/^[0-9a-f]{32}$/.test(id)).toBe(true);
    });

    it('generates unique IDs on each call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => tracer.generateTraceId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('generateSpanId', () => {
    it('generates a 16-char hex string', () => {
      const id = tracer.generateSpanId();
      expect(id).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(id)).toBe(true);
    });

    it('generates unique IDs on each call', () => {
      const ids = new Set(Array.from({ length: 50 }, () => tracer.generateSpanId()));
      expect(ids.size).toBe(50);
    });
  });

  describe('propagateTraceContext', () => {
    it('creates a new trace when traceId is null', () => {
      const ctx = tracer.propagateTraceContext(null, null, 'api.list');
      expect(ctx.traceId).toHaveLength(32);
      expect(ctx.spanId).toHaveLength(16);
      expect(ctx.parentSpanId).toBeNull();
    });

    it('preserves existing traceId when provided', () => {
      const traceId = 'f'.repeat(32);
      const ctx = tracer.propagateTraceContext(traceId, null, 'api.list');
      expect(ctx.traceId).toBe(traceId);
    });

    it('sets parentSpanId from incoming span', () => {
      const parentId = 'c'.repeat(16);
      const ctx = tracer.propagateTraceContext('t'.repeat(32), parentId, 'api.inner');
      expect(ctx.parentSpanId).toBe(parentId);
    });

    it('sets operationName on returned context', () => {
      const ctx = tracer.propagateTraceContext(null, null, 'mcp.query-context');
      expect(ctx.operationName).toBe('mcp.query-context');
    });

    it('generates a fresh spanId for the new span', () => {
      const parent = 'd'.repeat(16);
      const ctx = tracer.propagateTraceContext('t'.repeat(32), parent, 'op');
      expect(ctx.spanId).not.toBe(parent);
      expect(ctx.spanId).toHaveLength(16);
    });
  });

  describe('extractTraceFromHeaders', () => {
    it('parses valid W3C traceparent header', () => {
      const traceId = 'a'.repeat(32);
      const spanId = 'b'.repeat(16);
      const ctx = tracer.extractTraceFromHeaders({
        traceparent: `00-${traceId}-${spanId}-01`,
      });
      expect(ctx).not.toBeNull();
      expect(ctx!.traceId).toBe(traceId);
      expect(ctx!.parentSpanId).toBe(spanId);
    });

    it('returns null when traceparent header is missing', () => {
      const ctx = tracer.extractTraceFromHeaders({});
      expect(ctx).toBeNull();
    });

    it('returns null for malformed traceparent (wrong segments)', () => {
      const ctx = tracer.extractTraceFromHeaders({ traceparent: 'bad-header' });
      expect(ctx).toBeNull();
    });

    it('returns null for unsupported version', () => {
      const traceId = 'a'.repeat(32);
      const spanId = 'b'.repeat(16);
      const ctx = tracer.extractTraceFromHeaders({
        traceparent: `ff-${traceId}-${spanId}-01`,
      });
      expect(ctx).toBeNull();
    });

    it('returns null for wrong traceId length', () => {
      const ctx = tracer.extractTraceFromHeaders({
        traceparent: `00-${'a'.repeat(16)}-${'b'.repeat(16)}-01`,
      });
      expect(ctx).toBeNull();
    });

    it('handles array header values', () => {
      const traceId = 'a'.repeat(32);
      const spanId = 'b'.repeat(16);
      const ctx = tracer.extractTraceFromHeaders({
        traceparent: [`00-${traceId}-${spanId}-01`],
      });
      expect(ctx).not.toBeNull();
    });
  });

  describe('injectTraceIntoHeaders', () => {
    it('produces a valid W3C traceparent header', () => {
      const context: TraceContext = {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        parentSpanId: null,
      };
      const headers = tracer.injectTraceIntoHeaders(context);
      expect(headers['traceparent']).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
    });

    it('returned header is round-trip parseable', () => {
      const original: TraceContext = {
        traceId: tracer.generateTraceId(),
        spanId: tracer.generateSpanId(),
        parentSpanId: null,
      };
      const headers = tracer.injectTraceIntoHeaders(original);
      const parsed = tracer.extractTraceFromHeaders(headers);
      expect(parsed!.traceId).toBe(original.traceId);
    });
  });

  describe('recordSpan', () => {
    it('calls sql with INSERT statement', async () => {
      await tracer.recordSpan(makeSpan());
      expect(sql).toHaveBeenCalledOnce();
      const callArgs = sql.mock.calls[0] as [TemplateStringsArray];
      expect(callArgs[0].raw.join('?')).toContain('INSERT INTO request_traces');
    });

    it('records error status span', async () => {
      await tracer.recordSpan(makeSpan({ status: 'error', errors: ['something failed'] }));
      expect(sql).toHaveBeenCalledOnce();
    });

    it('records span with null durationMs', async () => {
      await tracer.recordSpan(makeSpan({ durationMs: null, endedAt: null }));
      expect(sql).toHaveBeenCalledOnce();
    });
  });

  describe('analyzeTrace', () => {
    it('returns empty analysis when no spans exist', async () => {
      sql = makeSql({ request_traces: [] });
      tracer = new RequestTracer(sql as unknown as ReturnType<typeof import('postgres').default>);
      const result = await tracer.analyzeTrace('trace-123');
      expect(result.totalSpans).toBe(0);
      expect(result.totalDurationMs).toBe(0);
      expect(result.criticalPath).toHaveLength(0);
    });

    it('sums total duration across all spans', async () => {
      const spans = [
        makeSpan({ durationMs: 100, spanId: 'a'.repeat(16), operationName: 'op1' }),
        makeSpan({ durationMs: 200, spanId: 'b'.repeat(16), operationName: 'op2' }),
      ];
      sql = makeSql({ request_traces: spans });
      tracer = new RequestTracer(sql as unknown as ReturnType<typeof import('postgres').default>);
      const result = await tracer.analyzeTrace('trace-x');
      expect(result.totalDurationMs).toBe(300);
    });

    it('counts error spans', async () => {
      const spans = [
        makeSpan({ status: 'ok', spanId: 'a'.repeat(16) }),
        makeSpan({ status: 'error', spanId: 'b'.repeat(16) }),
        makeSpan({ status: 'timeout', spanId: 'c'.repeat(16) }),
      ];
      sql = makeSql({ request_traces: spans });
      tracer = new RequestTracer(sql as unknown as ReturnType<typeof import('postgres').default>);
      const result = await tracer.analyzeTrace('trace-x');
      expect(result.errorCount).toBe(2);
    });

    it('returns slowest operations sorted by duration', async () => {
      const spans = [
        makeSpan({ durationMs: 50, spanId: 'a'.repeat(16), operationName: 'fast' }),
        makeSpan({ durationMs: 500, spanId: 'b'.repeat(16), operationName: 'slow' }),
        makeSpan({ durationMs: 200, spanId: 'c'.repeat(16), operationName: 'medium' }),
      ];
      sql = makeSql({ request_traces: spans });
      tracer = new RequestTracer(sql as unknown as ReturnType<typeof import('postgres').default>);
      const result = await tracer.analyzeTrace('trace-x');
      expect(result.slowestOperations[0]!.operationName).toBe('slow');
    });
  });
});
