// test/web/shimmer-period.spec.ts
//
// ADR-8 arbitration, WEB half — run in a REAL browser against the REAL
// production `<AutoSkeleton>`/`SkeletonProvider` graph, because the thing
// under test is a *resolved CSS animation duration*, which only a real
// engine can report (jsdom is banned project-wide for anything that reads
// layout/computed style — plan.md §7.3).
//
// Two separate defects live here and are asserted separately:
//
//   1. `SkeletonTheme.speedMs` never reached the web renderer AT ALL. The
//      module-scope `sharedClock` was created with `createShimmerClock()`'s
//      1400 ms default and `setPeriod` was never called from any web code
//      path, while `css-renderer.ts` writes `--askl-speed` from
//      `props.clock.periodMs` — so a consumer's explicitly-set `speedMs` was
//      silently discarded on web, even with a single theme.
//   2. Two themes asking for two different periods: ADR-8 allows exactly one
//      shared period, so the second one is refused — and said out loud.

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/component-entry.ts');

/** Waits two animation frames — the cold-measurement effect runs after
 *  commit, and the overlay mounts on the resulting re-render. Same helper
 *  shape as `auto-skeleton.spec.ts`. */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function mountReady(page: import('@playwright/test').Page): Promise<void> {
  await loadHarness(page, ENTRY, `<div id="root"></div>`);
  await page.evaluate(() => {
    (window as unknown as { __warnings: string[] }).__warnings = [];
    const original = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      (window as unknown as { __warnings: string[] }).__warnings.push(args.map(String).join(' '));
      original(...(args as []));
    };
  });
}

/** Every mounted shimmer layer's resolved `animation-duration`, in source
 *  order. This is the ONLY honest way to ask "did `speedMs` actually take
 *  effect": the value the browser will animate at, not a prop we passed. */
async function shimmerDurations(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.askl-shimmer-layer')).map(
      (el) => getComputedStyle(el).animationDuration,
    ),
  );
}

test.describe('ADR-8 shared shimmer period — web', () => {
  // The suite default is `reducedMotion: 'reduce'` (see playwright.config.ts's
  // own note), which downgrades the real component to the pulse class and
  // zeroes the shimmer layer's animation — the dedicated motion tests
  // override it explicitly, exactly as that comment prescribes, and this is
  // one of them: the property under test IS the shimmer duration.
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('a SkeletonProvider theme.speedMs actually drives the rendered shimmer duration', async ({ page }) => {
    await mountReady(page);
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          { store: new MemoryShapeStore(), theme: { speedMs: 600 } },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'speed-screen' },
            React.createElement('p', { style: { margin: 0, fontSize: 16 } }, 'Hello world'),
          ),
        ),
      );
    });
    await settle(page);

    expect(await shimmerDurations(page)).toEqual(['0.6s']);
  });

  test('two themes with different speedMs share ONE period (ADR-8) instead of drifting apart', async ({
    page,
  }) => {
    await mountReady(page);
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      const tree = (skeletonKey: string, speedMs: number) =>
        React.createElement(
          SkeletonProvider,
          { store, theme: { speedMs } },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey },
            React.createElement('p', { style: { margin: 0, fontSize: 16 } }, 'Hello world'),
          ),
        );
      root.render(
        React.createElement(React.Fragment, null, tree('screen-a', 600), tree('screen-b', 900)),
      );
    });
    await settle(page);

    const durations = await shimmerDurations(page);
    expect(durations).toHaveLength(2);
    expect(new Set(durations).size).toBe(1);
    expect(durations[0]).toBe('0.6s');
  });

  test('the refused speedMs is reported to the developer, never silently dropped', async ({ page }) => {
    await mountReady(page);
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      const tree = (skeletonKey: string, speedMs: number) =>
        React.createElement(
          SkeletonProvider,
          { store, theme: { speedMs } },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey },
            React.createElement('p', { style: { margin: 0, fontSize: 16 } }, 'Hello world'),
          ),
        );
      root.render(
        React.createElement(React.Fragment, null, tree('screen-a', 600), tree('screen-b', 900)),
      );
    });
    await settle(page);

    const warnings = await page.evaluate(() => (window as unknown as { __warnings: string[] }).__warnings);
    const conflict = warnings.filter((w) => w.includes('speedMs'));
    expect(conflict).toHaveLength(1);
    expect(conflict[0]).toContain('900');
    expect(conflict[0]).toContain('600');
  });
});
