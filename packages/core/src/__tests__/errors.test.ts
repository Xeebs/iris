import { describe, it, expect } from 'vitest';
import {
  IrisError,
  ConnectorError,
  IndexerError,
  CacheError,
  MCPError,
  ok,
  err,
} from '../errors.js';

describe('IrisError', () => {
  it('sets code and message', () => {
    const e = new IrisError('TEST_CODE', 'something went wrong');
    expect(e.code).toBe('TEST_CODE');
    expect(e.message).toBe('something went wrong');
    expect(e.name).toBe('IrisError');
    expect(e).toBeInstanceOf(Error);
  });

  it('stores cause when provided', () => {
    const cause = new Error('root cause');
    const e = new IrisError('CODE', 'wrapper', cause);
    expect(e.cause).toBe(cause);
  });
});

describe('ConnectorError', () => {
  it('has retryable flag and correct code', () => {
    const e = new ConnectorError('rate limited', true);
    expect(e.retryable).toBe(true);
    expect(e.code).toBe('CONNECTOR_ERROR');
    expect(e).toBeInstanceOf(IrisError);
  });

  it('can be non-retryable', () => {
    const e = new ConnectorError('invalid credentials', false);
    expect(e.retryable).toBe(false);
  });
});

describe('IndexerError', () => {
  it('has INDEXER_ERROR code', () => {
    const e = new IndexerError('embedding service unavailable');
    expect(e.code).toBe('INDEXER_ERROR');
    expect(e).toBeInstanceOf(IrisError);
  });
});

describe('CacheError', () => {
  it('has CACHE_ERROR code', () => {
    const e = new CacheError('redis connection failed');
    expect(e.code).toBe('CACHE_ERROR');
    expect(e).toBeInstanceOf(IrisError);
  });
});

describe('MCPError', () => {
  it('has MCP_ERROR code', () => {
    const e = new MCPError('tool execution failed');
    expect(e.code).toBe('MCP_ERROR');
    expect(e).toBeInstanceOf(IrisError);
  });
});

describe('Result helpers', () => {
  it('ok() wraps a success value', () => {
    const r = ok(42);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap()).toBe(42);
  });

  it('err() wraps an error value', () => {
    const e = new ConnectorError('oops', false);
    const r = err(e);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toBe(e);
  });
});
