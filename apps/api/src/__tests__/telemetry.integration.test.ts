import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn(),
}));

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn().mockReturnValue([]),
}));

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: vi.fn().mockReturnValue({}),
}));

vi.mock('@opentelemetry/semantic-conventions', () => ({
  SEMRESATTRS_SERVICE_NAME: 'service.name',
  SEMRESATTRS_SERVICE_VERSION: 'service.version',
}));

vi.mock('@opentelemetry/api', () => ({
  trace: { getTracer: vi.fn().mockReturnValue({ startSpan: vi.fn().mockReturnValue({ setStatus: vi.fn(), end: vi.fn(), recordException: vi.fn() }) }) },
}));

import { NodeSDK } from '@opentelemetry/sdk-node';
import { initTelemetry, shutdownTelemetry, getTracer, startSpan } from '../telemetry.js';

describe('initTelemetry', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Reset module-level sdk to null by re-importing
    vi.resetModules();
  });

  it('does not initialize SDK when OTEL endpoint is not set', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    const { initTelemetry: init } = await import('../telemetry.js');
    init();
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('initializes SDK when OTEL endpoint is set', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    const { initTelemetry: init } = await import('../telemetry.js');
    init();
    expect(NodeSDK).toHaveBeenCalledTimes(1);
  });
});

describe('shutdownTelemetry', () => {
  it('resolves without error when SDK is null', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    const { initTelemetry: init, shutdownTelemetry: shutdown } = await import('../telemetry.js');
    init();
    await expect(shutdown()).resolves.toBeUndefined();
  });
});

describe('getTracer', () => {
  it('returns a tracer from the trace API', () => {
    const tracer = getTracer('test');
    expect(tracer).toBeDefined();
  });
});

describe('startSpan', () => {
  it('executes the fn and returns its result', async () => {
    const tracer = getTracer('test');
    const result = await startSpan(tracer, 'test-span', {}, async (_span) => 42);
    expect(result).toBe(42);
  });

  it('ends the span on success', async () => {
    const tracer = getTracer('test');
    const { trace } = await import('@opentelemetry/api');
    const mockSpan = { setStatus: vi.fn(), end: vi.fn(), recordException: vi.fn() };
    vi.mocked(trace.getTracer('test').startSpan).mockReturnValue(mockSpan as never);
    await startSpan(tracer, 'test-span', {}, async (_span) => 'ok');
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('records exception and ends span on error', async () => {
    const tracer = getTracer('test');
    const { trace } = await import('@opentelemetry/api');
    const mockSpan = { setStatus: vi.fn(), end: vi.fn(), recordException: vi.fn() };
    vi.mocked(trace.getTracer('test').startSpan).mockReturnValue(mockSpan as never);
    await expect(
      startSpan(tracer, 'test-span', {}, async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
    expect(mockSpan.recordException).toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalled();
  });
});
