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
  },
});
