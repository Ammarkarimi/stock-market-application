import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
    pool: 'forks',
    // Each test file starts its own PGlite (Postgres in WebAssembly) and seeds a year of market data.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
