// test/web/ssr-hydrate.spec.ts
//
// `<AutoSkeleton.SSRHydrate>` — the client half of the SSR story, and until
// now the untested half. `AutoSkeletonSSR` has unit tests, the manifest/CSS
// binding has `ssr-drift.spec.ts`, the served markup has
// `test/ssr/dashboard.spec.ts`; the bridge that turns build-time snapshots
// into a RUNTIME cache hit had no test at all, only a call site in
// `examples/next/app/layout.tsx`. `examples/next/app/client-cache` now
// demonstrates that behaviour to a reader, so it needs a gate rather than a
// demonstration alone.
//
// Playwright, not Vitest, because the claim is about geometry the runtime
// composes from a real viewport width and a real font scale: the cache key is
// `skeletonKey | itemType | widthBucket | fontScale | direction | platform`,
// and jsdom is banned project-wide for anything that reads layout.
//
// The wiring under test is the production one — no `<SkeletonProvider>`, so
// the bridge and the component must meet in the module-level `defaultStore`.
// Each test gets a fresh page, so that module state is fresh too.

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadHarness } from './helpers/page';
import { computeSsrManifestIntegrity } from '../../src/web/ssr/integrity';
import type { AutoSkeletonSSRManifest } from '../../src/web/ssr/manifest';
import { SSR_MANIFEST_VERSION } from '../../src/web/ssr/manifest';

const ENTRY = path.join(__dirname, 'helpers/ssr-hydrate-entry.ts');

/** The viewport is pinned so `bucketWidth()` resolves to a known bucket: the
 *  manifest below is captured for exactly that bucket, and the negative
 *  control below is captured for a different one. */
const VIEWPORT = { width: 1280, height: 900 } as const;
const CAPTURED_BUCKET = 1280;
const UNCAPTURED_BUCKET = 375;
const CAPTURED_FRAME: readonly [number, number] = [640, 312];
/** `[schemaVersion, (x, y, w, h, r) x 3]` — three shapes, so a replay can be
 *  told apart from a live traversal of the harness markup by shape count as
 *  well as by `cacheHit`. */
const CAPTURED_WIRE = [1, 24, 24, 220, 32, 4, 24, 72, 592, 160, 8, 24, 248, 552, 16, 4];
const CAPTURED_SHAPE_COUNT = 3;

interface RecordedMetrics {
  readonly cacheHit: boolean;
  readonly traversalMs: number;
  readonly shapeCount: number;
  readonly renderer: string;
}

/** Builds a manifest whose single entry is keyed exactly the way the runtime
 *  composes its key at `VIEWPORT`, so a hit is a real key match rather than a
 *  fixture engineered around the assertion. */
function manifestFor(options: { bucket: number; version?: number }): AutoSkeletonSSRManifest {
  const bucket = options.bucket;
  const base: AutoSkeletonSSRManifest = {
    v: options.version ?? SSR_MANIFEST_VERSION,
    integrity: '',
    widthBuckets: [bucket],
    capturedKeys: ['dashboard'],
    entries: [
      {
        skeletonKey: 'dashboard',
        widthBucket: bucket,
        direction: 'ltr',
        snapshot: {
          v: 1,
          key: `v1|dashboard|-|${bucket}|1|ltr|web`,
          capturedAt: 1_700_000_000_000,
          frame: CAPTURED_FRAME,
          data: CAPTURED_WIRE,
        },
      },
    ],
  };
  return { ...base, integrity: computeSsrManifestIntegrity(base) };
}

/** Mounts the bridge, lets its effect run, then mounts a live
 *  `<AutoSkeleton>` for the same key and drives one complete loading cycle.
 *  `onMetrics` fires once, when the handoff controller settles, so the cycle
 *  has to finish before there is anything to assert. */
async function hydrateThenMount(
  page: import('@playwright/test').Page,
  manifest: AutoSkeletonSSRManifest,
): Promise<RecordedMetrics> {
  await page.setViewportSize({ ...VIEWPORT });
  await loadHarness(page, ENTRY, `<div id="bridge"></div><div id="app"></div>`);

  await page.evaluate((serializedManifest: AutoSkeletonSSRManifest) => {
    const { React, createRoot, AutoSkeletonSSRHydrate, __resetFontScaleForTests } =
      window.AutoskeletonSsrHydrate;
    __resetFontScaleForTests();
    (window as unknown as { __metrics: RecordedMetrics[] }).__metrics = [];
    createRoot(document.getElementById('bridge')!).render(
      React.createElement(AutoSkeletonSSRHydrate, { manifest: serializedManifest }),
    );
  }, manifest);

  // The bridge imports in an effect. Two frames is the same settle the other
  // component specs use for "effects have run and the resulting re-render has
  // committed".
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  // A SEPARATE root, mounted after the bridge has already run — the
  // client-side-navigation case the architecture actually claims, not a
  // sibling racing the same first render.
  await page.evaluate(() => {
    const { React, createRoot, AutoSkeleton } = window.AutoskeletonSsrHydrate;
    const root = createRoot(document.getElementById('app')!);
    const render = (isLoading: boolean) =>
      root.render(
        React.createElement(
          AutoSkeleton,
          {
            isLoading,
            skeletonKey: 'dashboard',
            onMetrics: (m: RecordedMetrics) =>
              (window as unknown as { __metrics: RecordedMetrics[] }).__metrics.push(m),
          },
          React.createElement('p', { style: { margin: 0, fontSize: 16 } }, 'Dashboard content'),
        ),
      );
    render(true);
    window.setTimeout(() => render(false), 50);
  });

  await page.waitForFunction(
    () => (window as unknown as { __metrics: RecordedMetrics[] }).__metrics.length > 0,
    undefined,
    { timeout: 10_000 },
  );
  const metrics = await page.evaluate(
    () => (window as unknown as { __metrics: RecordedMetrics[] }).__metrics[0]!,
  );
  return metrics;
}

test.describe('AutoSkeleton.SSRHydrate — build-time snapshots become a runtime cache hit', () => {
  test('a live AutoSkeleton mounted after the bridge replays the captured snapshot with zero traversal', async ({
    page,
  }) => {
    const metrics = await hydrateThenMount(page, manifestFor({ bucket: CAPTURED_BUCKET }));

    expect(metrics.cacheHit).toBe(true);
    expect(metrics.traversalMs).toBe(0);
    // The shapes came from the manifest, not from the harness markup: the
    // paragraph in `#app` is one text line, never three rects.
    expect(metrics.shapeCount).toBe(CAPTURED_SHAPE_COUNT);
    expect(metrics.renderer).toBe('css');
  });

  test('a snapshot captured for a DIFFERENT width bucket is not served to this viewport', async ({
    page,
  }) => {
    // The composite key is the whole point: replaying somebody else's width
    // would be worse than measuring, so this must miss and measure.
    const metrics = await hydrateThenMount(page, manifestFor({ bucket: UNCAPTURED_BUCKET }));

    expect(metrics.cacheHit).toBe(false);
    expect(metrics.traversalMs).toBeGreaterThan(0);
  });

  test('a manifest this build cannot replay is refused by the bridge, not smuggled into the store', async ({
    page,
  }) => {
    // `<AutoSkeleton.SSR>` already refuses to render geometry from an
    // unreplayable manifest. If the bridge imported the same entries anyway,
    // that geometry would re-enter through the back door as a "hot path"
    // cache hit for a later client mount.
    const metrics = await hydrateThenMount(
      page,
      manifestFor({ bucket: CAPTURED_BUCKET, version: SSR_MANIFEST_VERSION + 1 }),
    );

    expect(metrics.cacheHit).toBe(false);
    expect(metrics.traversalMs).toBeGreaterThan(0);
  });
});
