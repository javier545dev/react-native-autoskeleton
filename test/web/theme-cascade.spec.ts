// test/web/theme-cascade.spec.ts
//
// tasks.md 7.1 (spec REQ-THEME-1): the `--skl-base`/`--skl-highlight` CSS
// custom-property contract must be genuinely themeable via a real Tailwind
// v4 build (`@theme`/`:root`, spec.md §1.9's own scenario text names both as
// valid locations), and dark mode must flip the shimmer colors PURELY via
// CSS cascade — toggling a class, never a React prop or a renderer method
// call. Runs the REAL production `createCssRenderer()` (task 2.2) against
// CSS compiled by the REAL `@tailwindcss/cli` (see helpers/tailwind.ts) —
// never a hand-authored CSS string standing in for either.

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadHarness } from './helpers/page';
import { compileTailwindCss } from './helpers/tailwind';

const ENTRY = path.join(__dirname, 'helpers/css-renderer-entry.ts');
/** The real `<AutoSkeleton>`/`SkeletonProvider` tree, for the component-level
 *  case at the bottom of this file. */
const COMPONENT_ENTRY = path.join(__dirname, 'helpers/component-entry.ts');

/** Mounts the real CSS renderer with the library's DEFAULT theme — i.e. NO
 *  explicit `baseColor`/`highlightColor` override — which is the shape every
 *  `<AutoSkeleton>` consumer gets unless they pass a `SkeletonProvider theme`
 *  prop. This is deliberate: REQ-THEME-1's whole point is that a consumer
 *  who changes NOTHING but their CSS should see the shimmer follow. */
async function mountWithDefaultTheme(page: import('@playwright/test').Page, extraHeadHtml: string): Promise<void> {
  await loadHarness(
    page,
    ENTRY,
    `<div id="surface" style="position:relative;width:100px;height:70px;"></div>`,
    { extraHeadHtml },
  );
  await page.evaluate(() => {
    const { createCssRenderer, createShimmerClock, encodeWire, WIRE_VERSION, composeCacheKey } = window.Autoskeleton;
    const renderer = createCssRenderer!();
    const clock = createShimmerClock!(100000); // long period: no shimmer-phase color noise
    const surface = document.getElementById('surface')!;
    const key = composeCacheKey!({
      skeletonKey: 'theme-test',
      viewportWidth: 375,
      fontScale: 1,
      direction: 'ltr',
      platform: 'web',
    });
    const snapshot = {
      key,
      version: WIRE_VERSION!,
      capturedAt: Date.now(),
      frameWidth: 100,
      frameHeight: 70,
      data: encodeWire!([{ x: 0, y: 0, w: 100, h: 70, r: 0 }]),
      degraded: [],
    };
    renderer.mount(surface, {
      snapshot,
      // The library's own DEFAULT_THEME shape — matches what a consumer gets
      // with zero SkeletonProvider customization.
      theme: { baseColor: '#e2e2e2', highlightColor: '#f5f5f5', defaultRadius: 4, speedMs: 1400 },
      animation: 'none', // 'none' so the base layer's resolved color is stable, not shimmer-phase-dependent
      clock,
      reducedMotion: false,
      debugOverlay: false,
    });
  });
}

async function baseOverlayColor(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector('.askl-overlay')!).backgroundColor);
}

test.describe('Theming via Tailwind v4 (REQ-THEME-1, tasks.md 7.1)', () => {
  test('a Tailwind v4 @theme-compiled --skl-base overrides the library default with no prop change', async ({
    page,
  }) => {
    // Real Tailwind v4 @theme block. Namespaced (`--color-*`) keys are the
    // form Tailwind v4 actually preserves from @theme (verified against the
    // real compiler: an arbitrary non-namespaced key inside @theme is
    // silently dropped) — aliased at :root into the library's own
    // `--skl-base`/`--skl-highlight` contract names, which spec.md §1.9's own
    // scenario explicitly allows ("inside `@theme` or `:root`").
    const compiled = compileTailwindCss(`@import "tailwindcss";

@theme {
  --color-skl-base: #336699;
  --color-skl-highlight: #99ccff;
}

:root {
  --skl-base: var(--color-skl-base);
  --skl-highlight: var(--color-skl-highlight);
}
`);
    expect(compiled).toContain('--color-skl-base');

    await mountWithDefaultTheme(page, `<style>${compiled}</style>`);
    const color = await baseOverlayColor(page);
    // #336699 -> rgb(51, 102, 153)
    expect(color).toBe('rgb(51, 102, 153)');
    // And NOT the library's hardcoded JS default (#e2e2e2 -> rgb(226,226,226))
    expect(color).not.toBe('rgb(226, 226, 226)');
  });

  test('toggling a dark-mode class changes the shimmer colors via CSS cascade, with no prop change', async ({
    page,
  }) => {
    const compiled = compileTailwindCss(`@import "tailwindcss";

:root {
  --skl-base: #e5e7eb;
  --skl-highlight: #f3f4f6;
}

.dark {
  --skl-base: #1f2937;
  --skl-highlight: #374151;
}
`);
    // Sanity: both declarations really came out of the real Tailwind v4 build.
    expect(compiled).toContain('--skl-base: #e5e7eb');
    expect(compiled).toContain('.dark');

    await mountWithDefaultTheme(page, `<style>${compiled}</style>`);

    const lightColor = await baseOverlayColor(page);
    expect(lightColor).toBe('rgb(229, 231, 235)'); // #e5e7eb

    // The ONLY action taken is toggling a class on <html> — no renderer
    // method call, no re-mount, no React prop change of any kind.
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const darkColor = await baseOverlayColor(page);
    expect(darkColor).toBe('rgb(31, 41, 55)'); // #1f2937
    expect(darkColor).not.toBe(lightColor);
  });
});

// The COMPONENT half of the mounted-theme fix. `css-renderer.spec.ts` proves
// the handle's `setTheme` repaints; this proves `<AutoSkeleton>` actually calls
// it when a provider theme changes, which is where the defect lived: `theme`
// was already in the effect's dependency list, so the effect re-ran on every
// theme change and then pushed only `update(snapshot)` and
// `setAnimation(animation)` through. The new palette had nowhere to go.
//
// Without this case the renderer test passes with the call site removed — I
// checked — so this is the one that pins the user-visible behaviour: toggle a
// dark mode while a skeleton is on screen and the skeleton follows.
test.describe('a SkeletonProvider theme change repaints skeletons already on screen', () => {
  test('re-rendering the provider with a new palette updates the mounted overlay', async ({ page }) => {
    await loadHarness(page, COMPONENT_ENTRY, `<div id="root"></div>`);

    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } =
        window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      const w = window as unknown as { __render: (base: string, highlight: string) => void };
      w.__render = (baseColor: string, highlightColor: string) => {
        root.render(
          React.createElement(
            SkeletonProvider,
            { store, theme: { baseColor, highlightColor } },
            React.createElement(
              AutoSkeleton,
              { isLoading: true, skeletonKey: 'themed-screen' },
              React.createElement('p', { style: { margin: 0, fontSize: 16 } }, 'Hello world'),
            ),
          ),
        );
      };
      w.__render('#0f3d5c', '#1b6ea8');
    });
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const ramp = async () =>
      page.evaluate(() => {
        const overlay = document.querySelector('.askl-overlay') as HTMLElement | null;
        return overlay === null
          ? null
          : {
              base: overlay.style.getPropertyValue('--skl-base'),
              highlight: overlay.style.getPropertyValue('--skl-highlight'),
            };
      });

    expect(await ramp(), 'the skeleton never mounted, so there is nothing to re-theme').toEqual({
      base: '#0f3d5c',
      highlight: '#1b6ea8',
    });

    // The dark-mode toggle, in the only form that matters: same mounted
    // overlay, new provider theme.
    await page.evaluate(() => {
      (window as unknown as { __render: (b: string, h: string) => void }).__render('#5c1f0f', '#a8511b');
    });
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    expect(
      await ramp(),
      'the overlay kept its mount-time palette after the provider theme changed — the skeleton ' +
        'on screen is still wearing the old colours',
    ).toEqual({ base: '#5c1f0f', highlight: '#a8511b' });
  });
});
