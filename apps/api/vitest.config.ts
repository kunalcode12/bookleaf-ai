import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Each file boots its own in-memory Postgres (PGlite); keep them isolated and give WASM time.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
