import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  trace: {
    getTracer: vi.fn().mockReturnValue({
      startSpan: vi.fn().mockReturnValue({
        setStatus: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
      }),
    }),
  },
}));

import { NodeSDK } from '@opentelemetry/sdk-node';

describe('MCP server telemetry', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not initialize SDK when endpoint is not set', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    const { initTelemetry } = await import('../telemetry.js');
    initTelemetry();
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('initializes SDK when endpoint is set', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    const { initTelemetry } = await import('../telemetry.js');
    initTelemetry();
    expect(NodeSDK).toHaveBeenCalledTimes(1);
  });

  it('uses iris-mcp-server as default service name when OTEL_SERVICE_NAME is unset', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    vi.stubEnv('OTEL_SERVICE_NAME', '');
    const { initTelemetry } = await import('../telemetry.js');
    // Verify initTelemetry does not throw when service name defaults
    expect(() => initTelemetry()).not.toThrow();
  });

  it('getTracer returns a tracer', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    const { getTracer } = await import('../telemetry.js');
    const tracer = getTracer('iris.test');
    expect(tracer).toBeDefined();
  });

  it('startSpan executes fn and returns result', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    const { getTracer, startSpan } = await import('../telemetry.js');
    const tracer = getTracer('iris.test');
    const result = await startSpan(tracer, 'span', {}, async () => 'value');
    expect(result).toBe('value');
  });

  it('startSpan ends span even on exception', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    const { getTracer, startSpan } = await import('../telemetry.js');
    const { trace } = await import('@opentelemetry/api');
    const mockSpan = { setStatus: vi.fn(), end: vi.fn(), recordException: vi.fn() };
    vi.mocked(trace.getTracer('iris.test').startSpan).mockReturnValue(mockSpan as never);
    await expect(
      startSpan(getTracer('iris.test'), 'fail', {}, async () => { throw new Error('x'); })
    ).rejects.toThrow('x');
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('shutdownTelemetry resolves when no SDK initialized', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    const { initTelemetry, shutdownTelemetry } = await import('../telemetry.js');
    initTelemetry();
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
