import { defineConfig, devices } from '@playwright/test';

// plan.md §7.3: DOM sensor / CSS renderer / SSR tests need real browser layout —
// jsdom does not implement per-line `getClientRects()` geometry (jsdom #653, #3729)
// and is banned project-wide for anything that reads layout. This config is the
// harness those tests run under.
//
// Determinism, per plan.md §7.3 (this is where browser layout tests usually rot):
//   1. Playwright version AND browser build are pinned (package-lock.json + the
//      `chromium` browser binary installed via `npx playwright install chromium`,
//      matching `node_modules/playwright-core/browsers.json`'s pinned revision).
//      CI MUST run inside the matching `mcr.microsoft.com/playwright` container
//      image so the font stack and rasterizer are identical to what a developer
//      gets locally from the same image — see `.github/workflows/playwright.yml`.
//   2. Every fixture loads the self-hosted test font at
//      `test/fixtures/fonts/test-font.woff2` with `font-display: block` and awaits
//      `document.fonts.ready` before measuring. No system font ever participates.
//   3. `deviceScaleFactor: 1`, explicit per-test viewports for each `WIDTH_BUCKETS`
//      entry, and Chromium launch flags below fix rendering across machines.
//   4. Geometry assertions use a 0.5 px tolerance helper (added alongside the DOM
//      sensor in Phase 2), never `toEqual` on raw floats.
//   5. Pixel screenshots are reserved for the shimmer/reduced-motion visual checks
//      only (`maxDiffPixelRatio` + a masked animation region); everything else
//      asserts geometry numerically.
export default defineConfig({
  testDir: './test',
  testMatch: ['web/**/*.spec.ts', 'ssr/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    deviceScaleFactor: 1,
    // Motion is off by default so layout/geometry tests are not incidentally
    // flaky from an in-flight shimmer frame; the dedicated shimmer/reduced-motion
    // tests (2.2/3.4/4.6) override this to 'no-preference' explicitly.
    // NOTE: in @playwright/test 1.62.1, `reducedMotion` lives under
    // `contextOptions`, not as a flat `use` field — a real API surface change
    // discovered while scaffolding this config, not the older flat-field shape.
    contextOptions: {
      reducedMotion: 'reduce',
    },
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--force-device-scale-factor=1',
        '--font-render-hinting=none',
        '--disable-lcd-text',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
