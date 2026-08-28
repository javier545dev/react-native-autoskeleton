import { defineConfig } from 'vitest/config';

// plan.md §7: Vitest owns `src/core/` (pure TypeScript, zero platform deps), the
// packaging/RISK-5 detector under `test/packaging/`, native-bridge mocks under
// `test/native/`, and the capture CLI under `cli/`. Everything that needs real
// browser layout (`getClientRects()`, `getComputedStyle()`) lives under `test/web/`
// and `test/ssr/` and is explicitly OUT of this config — jsdom does not implement
// per-line text geometry (jsdom #653, #3729) and is banned project-wide for
// anything that reads layout. Those directories run under Playwright (0.3) instead.
export default defineConfig({
  test: {
    // Runs `bob build` exactly ONCE, in a single process, before any test file
    // (and therefore any worker) starts — fixes a structural race where
    // `test/packaging/entries.test.ts` and `test/packaging/web-bundle.test.ts`
    // each independently rebuilt `lib/` in their own `beforeAll` and could
    // observe each other's concurrent rebuild under default file parallelism.
    // See `test/packaging/global-setup.ts` for the full explanation.
    globalSetup: ['./test/packaging/global-setup.ts'],
    // Explicit 'node' environment: no DOM shim of any kind, including jsdom.
    // A DOM-shaped API appearing here would be a smoke test that always passes
    // against nothing — exactly the jsdom trap plan.md §7.3 warns about.
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'test/packaging/**/*.test.ts',
      'test/native/**/*.test.ts',
      'cli/**/*.test.ts',
    ],
    exclude: [
      'node_modules/**',
      'lib/**',
      'examples/**',
      'test/web/**',
      'test/ssr/**',
      'test/fixtures/**',
    ],
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // plan.md §7 unit-coverage table: "100% of src/core/ branches on the
      // wire codec, key algebra and handoff state machine" — only these three
      // modules carry a hard coverage gate; the rest of src/core is measured
      // but not threshold-enforced at this phase.
      include: ['src/core/cache-key.ts', 'src/core/wire.ts', 'src/core/handoff.ts'],
      thresholds: {
        branches: 100,
        statements: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
