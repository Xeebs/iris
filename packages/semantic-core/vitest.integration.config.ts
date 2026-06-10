import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Integration tests hit real services (Postgres/pgvector, Redis) and are
// excluded from the unit config. Requires DATABASE_URL to be set — tests
// skip themselves when it is absent. Run via: pnpm test:integration
export default defineConfig({
  resolve: {
    alias: {
      '@iris/core/logger': path.resolve(__dirname, '../core/src/logger.ts'),
      '@iris/core/errors': path.resolve(__dirname, '../core/src/errors.ts'),
      '@iris/core/config': path.resolve(__dirname, '../core/src/config.ts'),
      '@iris/core/email-service': path.resolve(__dirname, '../core/src/email-service.ts'),
      '@iris/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@iris/connector-sdk': path.resolve(__dirname, '../connector-sdk/src/index.ts'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.integration.test.ts', 'src/**/__tests__/**/*.integration.test.ts'],
  },
});
