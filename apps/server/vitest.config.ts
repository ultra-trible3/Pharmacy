import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Points DATABASE_URL at pharmacy_test *before* any module imports `env.ts`.
    setupFiles: ['tests/setup.ts'],
    // Integration tests share one PostgreSQL database; run them serially to
    // keep fixtures deterministic and expose real concurrency inside each test.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/openapi.ts'],
    },
  },
});
