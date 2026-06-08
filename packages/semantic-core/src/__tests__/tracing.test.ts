import { describe, it, expect, vi } from 'vitest';
import {
  generateTraceId,
  generateSpanId,
  parseTraceparent,
  serializeTraceparent,
  newRootContext,
  childContext,
  computePercentiles,
  sanitizeAttributes,
  Span,
} from '../tracing.js';

describe('generateTraceId', () => {
  it('returns 32-char hex string', () => {
    const id = generateTraceId();
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique IDs', () => {
    expect(generateTraceId()).not.toBe(generateTraceId());
  });
});

describe('generateSpanId', () => {
  it('returns 16-char hex string', () => {
    const id = generateSpanId();
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('parseTraceparent', () => {
  const validHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

  it('parses a valid traceparent header', () => {
    const ctx = parseTraceparent(validHeader);
    expect(ctx).not.toBeNull();
    expect(ctx!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx!.parentSpanId).toBe('00f067aa0ba902b7');
    expect(ctx!.sampled).toBe(true);
  });

  it('returns null for malformed header', () => {
    expect(parseTraceparent('bad')).toBeNull();
    expect(parseTraceparent('01-abc-def-01')).toBeNull(); // wrong version
    expect(parseTraceparent('00-short-00f067aa0ba902b7-01')).toBeNull();
  });

  it('parses sampled=false correctly', () => {
    const ctx = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00');
    expect(ctx!.sampled).toBe(false);
  });
});

describe('serializeTraceparent', () => {
  it('produces valid W3C traceparent format', () => {
    const ctx = newRootContext();
    const header = serializeTraceparent(ctx);
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  });

  it('round-trips through parse', () => {
    const original = newRootContext();
    const header = serializeTraceparent(original);
    const parsed = parseTraceparent(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.traceId).toBe(original.traceId);
    expect(parsed!.parentSpanId).toBe(original.spanId);
  });
});

describe('newRootContext', () => {
  it('creates context with no parent', () => {
    const ctx = newRootContext();
    expect(ctx.parentSpanId).toBeNull();
    expect(ctx.traceId).toHaveLength(32);
    expect(ctx.spanId).toHaveLength(16);
    expect(ctx.sampled).toBe(true);
  });
});

describe('childContext', () => {
  it('inherits traceId and sets parent', () => {
    const parent = newRootContext();
    const child = childContext(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.spanId).not.toBe(parent.spanId);
  });
});

describe('computePercentiles', () => {
  it('returns zeros for empty input', () => {
    expect(computePercentiles([])).toEqual({ p50: 0, p95: 0, p99: 0 });
  });

  it('computes percentiles for sorted array', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const p = computePercentiles(vals);
    expect(p.p50).toBe(50);
    expect(p.p95).toBe(95);
    expect(p.p99).toBe(99);
  });

  it('handles single element', () => {
    const p = computePercentiles([42]);
    expect(p.p50).toBe(42);
    expect(p.p95).toBe(42);
    expect(p.p99).toBe(42);
  });
});

describe('sanitizeAttributes', () => {
  it('passes through non-PII attributes', () => {
    const attrs = { 'connector.id': 'hub1', latencyMs: 100, success: true };
    expect(sanitizeAttributes(attrs)).toEqual(attrs);
  });

  it('redacts PII-named keys', () => {
    const attrs = { email: 'user@example.com', phone: '555-1234', name: 'Alice' };
    const out = sanitizeAttributes(attrs);
    expect(out['email']).toBe('[REDACTED]');
    expect(out['phone']).toBe('[REDACTED]');
    expect(out['name']).toBe('Alice');
  });

  it('redacts partial key matches', () => {
    const attrs = { apiKey: 'secret', userPassword: 'hunter2', endpoint: '/api/v1' };
    const out = sanitizeAttributes(attrs);
    expect(out['apiKey']).toBe('[REDACTED]');
    expect(out['userPassword']).toBe('[REDACTED]');
    expect(out['endpoint']).toBe('/api/v1');
  });
});

describe('Span', () => {
  it('calls onEnd when ended', () => {
    const ctx = newRootContext();
    const onEnd = vi.fn();
    const span = new Span(ctx, 'test.op', 'api', {}, onEnd);
    span.end();
    expect(onEnd).toHaveBeenCalledOnce();
    const data = onEnd.mock.calls[0]![0];
    expect(data.operationName).toBe('test.op');
    expect(data.status).toBe('ok');
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent (second end ignored)', () => {
    const onEnd = vi.fn();
    const span = new Span(newRootContext(), 'op', 'svc', {}, onEnd);
    span.end();
    span.end();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('records events', () => {
    const onEnd = vi.fn();
    const span = new Span(newRootContext(), 'op', 'svc', {}, onEnd);
    span.addEvent('cache.hit', { key: 'abc' });
    span.end();
    const data = onEnd.mock.calls[0]![0];
    expect(data.events).toHaveLength(1);
    expect(data.events[0].name).toBe('cache.hit');
  });

  it('records error status', () => {
    const onEnd = vi.fn();
    const span = new Span(newRootContext(), 'op', 'svc', {}, onEnd);
    span.end('error');
    expect(onEnd.mock.calls[0]![0].status).toBe('error');
  });

  it('sanitizes attributes on construction', () => {
    const onEnd = vi.fn();
    new Span(newRootContext(), 'op', 'svc', { email: 'x@y.com', 'connector.id': 'h1' }, onEnd).end();
    const data = onEnd.mock.calls[0]![0];
    expect(data.attributes['email']).toBe('[REDACTED]');
    expect(data.attributes['connector.id']).toBe('h1');
  });
});
