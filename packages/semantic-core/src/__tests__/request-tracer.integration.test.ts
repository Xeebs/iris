/**
 * Integration tests for RequestTracer — requires real Postgres.
 * Run with: pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { RequestTracer, type Span } from '../request-tracer.js';

const TEST_TRACE = 'integration-test-trace-' + Date.now().toString(16).padStart(8, '0').slice(0, 8);

let sql: ReturnType<typeof postgres>;
let tracer: RequestTracer;

const traceId = 'f'.repeat(32);

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    traceId,
    spanId: (Math.random().toString(16) + '0'.repeat(16)).slice(2, 18),
    parentSpanId: null,
    operationName: 'integration.test',
    serviceName: 'test',
    durationMs: 100,
    status: 'ok',
    metadata: { test: true },
    errors: null,
    startedAt: new Date(),
    endedAt: new Date(),
    workspaceId: 'test-workspace',
    ...overrides,
  };
}

beforeAll(async () => {
  sql = postgres(process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test');
  tracer = new RequestTracer(sql, 'integration-test');
});

afterAll(async () => {
  await sql`DELETE FROM request_traces WHERE trace_id = ${traceId}`;
  await sql.end();
});

describe('RequestTracer integration', () => {
  it('records a span and retrieves it', async () => {
    const span = makeSpan();
    await tracer.recordSpan(span);
    const retrieved = await tracer.getTrace(traceId);
    expect(retrieved.length).toBeGreaterThan(0);
    expect(retrieved[0]!.operationName).toBe('integration.test');
  });

  it('getTrace returns empty array for unknown trace', async () => {
    const result = await tracer.getTrace('0'.repeat(32));
    expect(result).toHaveLength(0);
  });

  it('records multiple spans for the same trace', async () => {
    for (let i = 0; i < 3; i++) {
      await tracer.recordSpan(makeSpan({ spanId: i.toString().padStart(16, '0'), operationName: `op-${i}` }));
    }
    const spans = await tracer.getTrace(traceId);
    expect(spans.length).toBeGreaterThanOrEqual(3);
  });

  it('ON CONFLICT DO NOTHING prevents duplicate spans', async () => {
    const span = makeSpan({ spanId: 'dupe'.padEnd(16, '0') });
    await tracer.recordSpan(span);
    await tracer.recordSpan(span);
    const spans = await tracer.getTrace(traceId);
    const dupes = spans.filter((s) => s.spanId === span.spanId);
    expect(dupes).toHaveLength(1);
  });

  it('analyzeTrace returns correct span count', async () => {
    const analysis = await tracer.analyzeTrace(traceId);
    expect(analysis.totalSpans).toBeGreaterThan(0);
    expect(analysis.traceId).toBe(traceId);
  });

  it('analyzeTrace builds critical path', async () => {
    const analysis = await tracer.analyzeTrace(traceId);
    expect(Array.isArray(analysis.criticalPath)).toBe(true);
  });

  it('injectTraceIntoHeaders round-trips through extractTraceFromHeaders', () => {
    const ctx = tracer.propagateTraceContext(traceId, null, 'test');
    const headers = tracer.injectTraceIntoHeaders(ctx);
    const parsed = tracer.extractTraceFromHeaders(headers);
    expect(parsed!.traceId).toBe(traceId);
  });

  it('publishTraceToBackend records all spans', async () => {
    const publishTraceId = ('pub' + Date.now().toString(16)).padEnd(32, '0').slice(0, 32);
    const spans = [
      makeSpan({ traceId: publishTraceId, spanId: '1'.padStart(16, '0') }),
      makeSpan({ traceId: publishTraceId, spanId: '2'.padStart(16, '0') }),
    ];
    await tracer.publishTraceToBackend(publishTraceId, spans);
    const retrieved = await tracer.getTrace(publishTraceId);
    expect(retrieved).toHaveLength(2);
    await sql`DELETE FROM request_traces WHERE trace_id = ${publishTraceId}`;
  });
});
