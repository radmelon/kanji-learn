import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 15000,
    // Integration tests share a single Postgres instance. Running test
    // files in parallel causes cross-file write contamination — e.g. the
    // UKG backfill test iterates ALL user_kanji_progress rows, including
    // ones written by other files mid-flight. Serial file execution trades
    // a few hundred ms for determinism.
    fileParallelism: false,
  },
})
