import { describe, it, expect, vi } from 'vitest';
import { createRequestContext, contextMeta, elapsedMs } from '../request-context.js';

describe('createRequestContext', () => {
  it('generates unique correlationId each call', () => {
    const c1 = createRequestContext();
    const c2 = createRequestContext();
    expect(c1.correlationId).not.toBe(c2.correlationId);
  });

  it('uses provided correlationId when given', () => {
    const ctx = createRequestContext(undefined, undefined, 'my-correlation-id');
    expect(ctx.correlationId).toBe('my-correlation-id');
  });

  it('generates unique traceId and spanId', () => {
    const ctx = createRequestContext();
    expect(ctx.traceId).toHaveLength(32);
    expect(ctx.spanId).toHaveLength(16);
  });

  it('sets userId and workspaceId when provided', () => {
    const ctx = createRequestContext('user-1', 'ws-1');
    expect(ctx.userId).toBe('user-1');
    expect(ctx.workspaceId).toBe('ws-1');
  });

  it('defaults userId and workspaceId to null', () => {
    const ctx = createRequestContext();
    expect(ctx.userId).toBeNull();
    expect(ctx.workspaceId).toBeNull();
  });

  it('sets startTime to approximately now', () => {
    const before = Date.now();
    const ctx = createRequestContext();
    const after = Date.now();
    expect(ctx.startTime).toBeGreaterThanOrEqual(before);
    expect(ctx.startTime).toBeLessThanOrEqual(after);
  });
});

describe('contextMeta', () => {
  it('includes correlationId, traceId, spanId', () => {
    const ctx = createRequestContext('u1', 'ws1');
    const meta = contextMeta(ctx);
    expect(meta['correlationId']).toBe(ctx.correlationId);
    expect(meta['traceId']).toBe(ctx.traceId);
    expect(meta['spanId']).toBe(ctx.spanId);
  });

  it('includes userId and workspaceId when set', () => {
    const ctx = createRequestContext('user-x', 'ws-x');
    const meta = contextMeta(ctx);
    expect(meta['userId']).toBe('user-x');
    expect(meta['workspaceId']).toBe('ws-x');
  });

  it('omits userId when null', () => {
    const ctx = createRequestContext();
    const meta = contextMeta(ctx);
    expect('userId' in meta).toBe(false);
  });

  it('merges extra fields', () => {
    const ctx = createRequestContext();
    const meta = contextMeta(ctx, { route: '/test', statusCode: 200 });
    expect(meta['route']).toBe('/test');
    expect(meta['statusCode']).toBe(200);
  });
});

describe('elapsedMs', () => {
  it('returns positive elapsed time', () => {
    const ctx = createRequestContext();
    const elapsed = elapsedMs(ctx);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('returns increasing values over time', async () => {
    const ctx = createRequestContext();
    const t1 = elapsedMs(ctx);
    await new Promise((r) => setTimeout(r, 5));
    const t2 = elapsedMs(ctx);
    expect(t2).toBeGreaterThan(t1);
  });
});
