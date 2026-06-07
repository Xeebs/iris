/**
 * OpenTelemetry tracing for the Iris API server.
 *
 * Call initTelemetry() before any other imports to ensure instrumentation
 * hooks into Node.js require before the libraries load.
 *
 * Exports: initTelemetry, getTracer, startSpan
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, type Span, type Tracer, type SpanOptions } from '@opentelemetry/api';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'telemetry' });

let sdk: NodeSDK | null = null;

/**
 * Initialize the OpenTelemetry SDK.
 * No-op if OTEL_EXPORTER_OTLP_ENDPOINT is not set.
 */
export function initTelemetry(): void {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'iris-api';
  const serviceVersion = process.env['npm_package_version'] ?? '1.0.0';

  if (!endpoint) {
    log.debug('OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled');
    return;
  }

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  log.info('OpenTelemetry tracing enabled', { endpoint, serviceName });
}

/**
 * Gracefully shut down the telemetry SDK (flush pending spans).
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      log.info('OpenTelemetry SDK shut down');
    } catch (e) {
      log.warn('OpenTelemetry shutdown error', { error: e });
    }
  }
}

/**
 * Get a tracer instance scoped to the given name.
 *
 * @param name - Instrumentation scope name (e.g., 'iris.indexer')
 */
export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

/**
 * Start a named span, execute fn, and end the span.
 * Automatically records exceptions and sets error status.
 *
 * @param tracer  - Tracer instance
 * @param name    - Span name
 * @param options - Additional span options (attributes, kind, etc.)
 * @param fn      - Function to execute within the span
 */
export async function startSpan<T>(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, options);
  try {
    const result = await fn(span);
    span.setStatus({ code: 0 }); // SpanStatusCode.OK
    return result;
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({ code: 2, message: String(err) }); // SpanStatusCode.ERROR
    throw err;
  } finally {
    span.end();
  }
}
