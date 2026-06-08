import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    root: __dirname,
    include: ['__tests__/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts'],
  },
});
