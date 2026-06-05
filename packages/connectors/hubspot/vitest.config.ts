import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@iris\/core\/(.+)$/, replacement: `${ROOT}/packages/core/src/$1.ts` },
      { find: '@iris/core', replacement: `${ROOT}/packages/core/src/index.ts` },
      { find: /^@iris\/connector-sdk\/(.+)$/, replacement: `${ROOT}/packages/connector-sdk/src/$1.ts` },
      { find: '@iris/connector-sdk', replacement: `${ROOT}/packages/connector-sdk/src/index.ts` },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
