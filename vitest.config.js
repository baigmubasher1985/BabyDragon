/**
 * Vitest config — security contract + Edge behavior unit tests (local only).
 * Does not connect to Supabase. No production URLs or secrets.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.test.ts'],
    passWithNoTests: false,
  },
})
