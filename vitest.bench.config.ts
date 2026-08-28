import { defineConfig } from 'vitest/config';

// tasks.md 9.1 — the CI benchmark suite. Deliberately SEPARATE from
// `vitest.config.ts`: these tests launch a real headless Chromium instance
// and run a real Vite production build, which is slow and would otherwise
// drag down the fast correctness suite every `npm test` run. Run via
// `npm run bench`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmarks/**/*.bench.test.ts'],
    exclude: ['node_modules/**', 'lib/**', 'examples/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
