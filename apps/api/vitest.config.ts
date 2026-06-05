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
      '@iris/semantic-core/sync-events': path.resolve(__dirname, '../../packages/semantic-core/src/sync-events.ts'),
      '@iris/semantic-core': path.resolve(__dirname, '../../packages/semantic-core/src/index.ts'),
      '@iris/compression': path.resolve(__dirname, '../../packages/compression/src/index.ts'),
      '@iris/queue': path.resolve(__dirname, '../../packages/queue/src/sync-job-queue.ts'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
  },
});
