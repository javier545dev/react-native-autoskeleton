import { defineConfig } from 'vitest/config';

// tasks.md 9.1 — the CI benchmark suite. Deliberately SEPARATE from
// `vitest.config.ts`: these tests launch a real headless Chromium instance
// and run a real Vite production build, which is slow and would otherwise
// drag down the fast correctness suite every `npm test` run. Run via
// `npm run bench`.
export default defineConfig({
  test: {
    // tasks.md G.13. Runs `bob build` exactly ONCE, in a single process, before
    // any test file (and therefore any worker) starts — fixes the structural
    // race where `benchmarks/web-benchmarks.bench.test.ts` and
    // `benchmarks/absolute.bench.test.ts` (via `run.ts` -> `measureWebEntryGzip`)
    // each independently rebuilt `lib/` and observed each other's concurrent
    // rebuild under default file parallelism (5 of 5 consecutive `npm run bench`
    // runs failed at 3aa3462). Same fix, same reason, as `vitest.config.ts`'s
    // `test/packaging/global-setup.ts` — see `benchmarks/support/lib-build.ts`.
    globalSetup: ['./benchmarks/global-setup.ts'],
    environment: 'node',
    include: ['benchmarks/**/*.bench.test.ts'],
    exclude: ['node_modules/**', 'lib/**', 'examples/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
