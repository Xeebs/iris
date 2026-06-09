import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@iris/connector-sdk': path.resolve(__dirname, '../../packages/connector-sdk/src/index.ts'),
      '@iris/core/logger': path.resolve(__dirname, '../../packages/core/src/logger.ts'),
      '@iris/core/errors': path.resolve(__dirname, '../../packages/core/src/errors.ts'),
      '@iris/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@iris/semantic-core/glossary': path.resolve(__dirname, '../../packages/semantic-core/src/glossary.ts'),
      '@iris/semantic-core/metrics': path.resolve(__dirname, '../../packages/semantic-core/src/metrics.ts'),
      '@iris/semantic-core/proactive-suggester': path.resolve(__dirname, '../../packages/semantic-core/src/proactive-suggester.ts'),
      '@iris/semantic-core/resource-builder': path.resolve(__dirname, '../../packages/semantic-core/src/resource-builder.ts'),
      '@iris/semantic-core/advanced-query-engine': path.resolve(__dirname, '../../packages/semantic-core/src/advanced-query-engine.ts'),
      '@iris/semantic-core/metrics-anomaly-detector': path.resolve(__dirname, '../../packages/semantic-core/src/metrics-anomaly-detector.ts'),
      '@iris/semantic-core/context-versioner': path.resolve(__dirname, '../../packages/semantic-core/src/context-versioner.ts'),
      '@iris/semantic-core/federation-manager': path.resolve(__dirname, '../../packages/semantic-core/src/federation-manager.ts'),
      '@iris/semantic-core/reliability-predictor': path.resolve(__dirname, '../../packages/semantic-core/src/reliability-predictor.ts'),
      '@iris/semantic-core/query-expansion-engine': path.resolve(__dirname, '../../packages/semantic-core/src/query-expansion-engine.ts'),
      '@iris/semantic-core/multi-connector-optimizer': path.resolve(__dirname, '../../packages/semantic-core/src/multi-connector-optimizer.ts'),
      '@iris/semantic-core/nl-query-generator': path.resolve(__dirname, '../../packages/semantic-core/src/nl-query-generator.ts'),
      '@iris/semantic-core/schema-discovery': path.resolve(__dirname, '../../packages/semantic-core/src/schema-discovery.ts'),
      '@iris/semantic-core': path.resolve(__dirname, '../../packages/semantic-core/src/index.ts'),
      '@iris/cache/semantic-cache': path.resolve(__dirname, '../../packages/cache/src/semantic-cache.ts'),
      '@iris/cache/response-cache': path.resolve(__dirname, '../../packages/cache/src/response-cache.ts'),
      '@iris/cache': path.resolve(__dirname, '../../packages/cache/src/index.ts'),
      '@iris/compression': path.resolve(__dirname, '../../packages/compression/src/index.ts'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['src/__tests__/**/*.integration.test.ts'],
  },
});
