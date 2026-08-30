// test/web/empty-measurement.spec.ts
//
// Defect gate (2026-08-29): a traversal that produced ZERO shapes used to be
// written into the shape store like any other result, and every later loading
// cycle served that empty snapshot straight back instead of re-measuring. An
// `<img>` (or any child) that had no layout box at the instant of the FIRST
// cold measurement therefore rendered a permanently blank skeleton — the
// overlay host mounted, `aria-hidden` was applied, the snapshot existed, and
// it drew nothing, forever, for the whole lifetime of that cache key.
//
// The fix does NOT say "never cache zero shapes": a subtree that genuinely has
// nothing to skeleton (fully `<AutoSkeleton.Ignore>`d, or entirely transparent
// structural wrappers) legitimately measures zero, and re-measuring it on every
// cycle would be a silent traversal hot-loop. It says an empty measurement is
// PROVISIONAL for a bounded, inspectable number of attempts per cache key
// (`MAX_EMPTY_MEASUREMENTS` / `store.emptyMeasurementsFor`) — the same shape of
// answer `MAX_MEASUREMENT_ATTEMPTS`/`attemptsFor` already gave the list
// template registry (tasks.md G.10).
//
// Both directions are gated here, in one real browser, against the real
// production component: the empty result must be re-measured (more than one
// traversal), and it must stop being re-measured (never more than the ceiling).

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { MAX_EMPTY_MEASUREMENTS } from '../../src/core/snapshot';
import { loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/component-entry.ts');

/** Real 2x2 PNG, inline so no network timing participates in the fixture. */
const PNG_2X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYkBBBgYGAAmFQGBv/1L5wAAAABJRU5ErkJggg==';

/** Two animation frames — the cold-measurement effect runs after commit, and
 *  the resulting re-render/overlay mount needs one more (matches
 *  `auto-skeleton.spec.ts`'s helper of the same name). */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** One full replay: `isLoading` false, then true again — a new loading cycle
 *  against the SAME cache key, which is exactly the situation the defect made
 *  permanently blank. */
async function replay(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => window.__autoskeletonHarness.setLoading(false));
  await settle(page);
  await page.evaluate(() => window.__autoskeletonHarness.setLoading(true));
  await settle(page);
  await settle(page);
}

function readShapeCounts(page: import('@playwright/test').Page): Promise<readonly number[]> {
  return page.evaluate(() =>
    Array.from(window.__autoskeletonHarness.store.values(), (s) => (s.data.length - 1) / 5),
  );
}

function readTraversalCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByName('autoskeleton-traversal').length);
}

/** Mounts one `<AutoSkeleton skeletonOnRefresh>` around `child`, exposing the
 *  store and the loading toggle on `window.__autoskeletonHarness`. */
async function mount(
  page: import('@playwright/test').Page,
  child: 'late-sized-image' | 'nothing-to-draw',
): Promise<void> {
  await loadHarness(page, ENTRY, `<div id="root"></div>`);
  await page.evaluate(
    ([kind, png]) => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      function App() {
        const [isLoading, setIsLoading] = React.useState(true);
        const [sized, setSized] = React.useState(false);
        window.__autoskeletonHarness = { store, setLoading: setIsLoading, setSized };
        const child =
          kind === 'late-sized-image'
            ? // Starts with a 0x0 layout box — the exact state a real <img> is
              // in before its bytes arrive and before any CSS gives it a size,
              // which is what made the first cold measurement produce nothing.
              React.createElement('img', {
                src: png,
                alt: '',
                id: 'hero-img',
                style: sized
                  ? { display: 'block', width: 170, height: 179 }
                  : { display: 'block', width: 0, height: 0 },
              })
            : // Genuinely nothing to skeleton: a real 200x40 box with no
              // background, no text and no leaf descendants. Measuring it
              // honestly yields zero shapes, every single time.
              React.createElement('div', { style: { width: 200, height: 40 } });
        return React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            { isLoading, skeletonKey: 'empty-measurement', skeletonOnRefresh: true },
            child,
          ),
        );
      }
      performance.clearMeasures();
      createRoot(document.getElementById('root')!).render(React.createElement(App));
    },
    [child, PNG_2X2] as const,
  );
  await settle(page);
}

test.describe('empty measurement is provisional, not a permanent answer', () => {
  test('a child that had no layout box at first measure is re-measured on the next loading cycle', async ({
    page,
  }) => {
    await mount(page, 'late-sized-image');

    // The first cold cycle honestly finds nothing: the image has a 0x0 box.
    expect(await readShapeCounts(page)).toEqual([0]);

    // The image now has a real 170x179 box, so a FRESH measurement of the
    // current DOM would find a shape. Before the fix, no fresh measurement
    // ever happened again for this cache key.
    await page.evaluate(() => window.__autoskeletonHarness.setSized(true));
    await settle(page);

    await replay(page);

    expect(await readShapeCounts(page)).toEqual([1]);
    const clipPath = await page.evaluate(
      () => getComputedStyle(document.querySelector('.askl-overlay')!).clipPath,
    );
    expect(clipPath).toContain('path(');
  });

  test('re-measurement of an empty result is bounded by an inspectable ceiling', async ({ page }) => {
    await mount(page, 'nothing-to-draw');

    // Far more replays than the ceiling allows.
    for (let i = 0; i < MAX_EMPTY_MEASUREMENTS + 3; i++) {
      await replay(page);
    }

    const traversals = await readTraversalCount(page);
    // Re-measured at all (the defect: exactly one traversal, ever)...
    expect(traversals).toBeGreaterThan(1);
    // ...but never past the ceiling (the over-correction: one traversal per
    // cycle, forever, for content that legitimately has nothing to draw).
    expect(traversals).toBeLessThanOrEqual(MAX_EMPTY_MEASUREMENTS);
    expect(await readShapeCounts(page)).toEqual([0]);
  });
});
