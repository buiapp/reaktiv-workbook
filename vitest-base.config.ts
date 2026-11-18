import { defineConfig } from 'vitest/config';

// Loaded by the Angular unit-test builder (angular.json: runnerConfig). Some App tests lay out
// whole workbooks in split panes; they need more than Vitest's 5 s on slower CI runners.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
