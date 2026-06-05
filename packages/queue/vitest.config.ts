import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@iris/core/logger': path.resolve(__dirname, '../core/src/logger.ts'),
      '@iris/core/errors': path.resolve(__dirname, '../core/src/errors.ts'),
      '@iris/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
