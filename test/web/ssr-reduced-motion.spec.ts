// test/web/ssr-reduced-motion.spec.ts
//
// REQ-A11Y-3 on the SSR path (spec §1.10: "When the platform's reduce-motion
// setting is enabled, the system MUST degrade the shimmer animation to a
// pulse or static presentation... AND no `transform`-based shimmer sweep is
// applied").
//
// The runtime web path already satisfies this through JavaScript:
// `AutoSkeleton.tsx`'s `reducedMotionPreferred()` reads
// `matchMedia('(prefers-reduced-motion: reduce)')` and `css-renderer.ts`'s
// `effectiveAnimation()` swaps the `askl-anim-shimmer` class for
// `askl-anim-pulse`. NONE of that exists before hydration: `AutoSkeletonSSR`
// and `NeutralSkeletonBlock` are hook-free, DOM-read-free pure functions that
// hard-code `className="askl-overlay askl-anim-shimmer"` (that purity IS the
// REQ-SSR-4 zero-mismatch mechanism, so reading `matchMedia` there is not an
// option). A user who asked for reduced motion therefore got a full
// travelling shimmer for the entire pre-hydration window.
//
// The only mechanism that can express the preference with zero JavaScript is
// CSS, which is why the fix lives in the generated SSR bundle
// (`cli/media-bundle.ts`) rather than in the components — and why this suite
// asserts against a REAL cascade in a REAL browser under a REAL
// `prefers-reduced-motion` context, not against a generated string.
//
// The overlay markup is hand-built here for the same reason
// `test/web/ssr-drift.spec.ts` documents: `@playwright/test` applies its own
// JSX transform to any `.tsx` a spec imports, so a Playwright spec cannot
// render this library's components. That `<AutoSkeleton.SSR>` /
// `<NeutralSkeletonBlock>` really emit these exact classes and attributes is
// pinned by `src/web/ssr/AutoSkeletonSSR.test.ts` under Vitest.

import { expect, test } from '@playwright/test';
import { buildSsrCssBundle } from '../../cli/media-bundle';
import { computeSsrManifestIntegrity } from '../../src/web/ssr/integrity';
import type { AutoSkeletonSSRManifest } from '../../src/web/ssr/manifest';
import { SSR_MANIFEST_VERSION } from '../../src/web/ssr/manifest';

const CAPTURED_WIDTH = 375;

/** The generated bundle paces the degraded pulse with `var(--askl-speed,
 *  1400ms)`, and SSR markup — which by REQ-SSR-4 reads nothing and sets no
 *  custom properties — always takes that fallback. */
const PULSE_PERIOD_MS = 1400;

function manifest(): AutoSkeletonSSRManifest {
  const base: AutoSkeletonSSRManifest = {
    v: SSR_MANIFEST_VERSION,
    integrity: '',
    widthBuckets: [CAPTURED_WIDTH],
    capturedKeys: ['dashboard'],
    entries: [
      {
        skeletonKey: 'dashboard',
        widthBucket: CAPTURED_WIDTH,
        direction: 'ltr',
        snapshot: {
          v: 1,
          key: `v1|dashboard|-|${CAPTURED_WIDTH}|1|ltr|web`,
          capturedAt: 1_700_000_000_000,
          frame: [CAPTURED_WIDTH, 312],
          data: [1, 24, 24, 220, 32, 4],
        },
      },
    ],
  };
  return { ...base, integrity: computeSsrManifestIntegrity(base) };
}

/** Mirrors `src/web/ssr/AutoSkeletonSSR.tsx`'s captured-key branch. */
function capturedOverlayMarkup(m: AutoSkeletonSSRManifest): string {
  return (
    `<div id="captured" aria-busy="true" role="status" data-askl-ssr-key="dashboard" ` +
    `data-askl-ssr-dir="ltr" data-askl-ssr-build="${m.integrity}" ` +
    `class="askl-overlay askl-anim-shimmer" style="position:relative;overflow:hidden">` +
    `<div class="askl-shimmer-layer"></div></div>`
  );
}

/** Mirrors `src/web/ssr/neutral-block.tsx` — the uncaptured-key / drift branch. */
function neutralBlockMarkup(): string {
  return (
    `<div id="neutral" aria-busy="true" role="status" data-askl-ssr-neutral="true" ` +
    `class="askl-overlay askl-anim-shimmer" style="position:relative;height:80px;overflow:hidden">` +
    `<div class="askl-shimmer-layer"></div></div>`
  );
}

/** A RUNTIME overlay: the exact classes `css-renderer.ts` mounts, with none
 *  of the SSR data attributes. It exists in this suite as a control — the SSR
 *  CSS must not reach across and disable the animation the runtime's own
 *  JavaScript path is authoritative for. */
function runtimeOverlayMarkup(): string {
  return (
    `<div id="runtime" class="askl-overlay askl-anim-shimmer" style="position:relative;height:80px;overflow:hidden">` +
    `<div class="askl-shimmer-layer"></div></div>`
  );
}

async function render(page: import('@playwright/test').Page): Promise<void> {
  const css = buildSsrCssBundle(manifest(), { defaultRadius: 4 });
  await page.setViewportSize({ width: CAPTURED_WIDTH, height: 800 });
  await page.setContent(
    `<!doctype html><html><head><style>${css}</style></head><body style="margin:0">` +
      `${capturedOverlayMarkup(manifest())}${neutralBlockMarkup()}${runtimeOverlayMarkup()}` +
      `</body></html>`,
    { waitUntil: 'load' },
  );
}

/** Every property an element's running CSS animations actually animate. Real
 *  `getAnimations()` inspection, exactly as `test/web/css-renderer.spec.ts`
 *  proves the ADR-6 transform-only rule — a class-name assertion would not
 *  show that the cascade really stopped the sweep. */
async function animatedProps(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<string[]> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) {
      return ['MISSING-ELEMENT'];
    }
    const props = new Set<string>();
    for (const anim of el.getAnimations()) {
      const effect = anim.effect as KeyframeEffect | null;
      for (const kf of effect?.getKeyframes() ?? []) {
        for (const key of Object.keys(kf)) {
          if (key !== 'offset' && key !== 'easing' && key !== 'composite') {
            props.add(key);
          }
        }
      }
    }
    return Array.from(props);
  }, selector);
}

// The suite-wide default context is `reducedMotion: 'reduce'` (see
// playwright.config.ts), which is exactly the condition under test here.
test.describe('SSR pre-hydration reduced motion (REQ-A11Y-3)', () => {
  test('the captured-key overlay applies no transform sweep', async ({ page }) => {
    await render(page);
    expect(await animatedProps(page, '#captured .askl-shimmer-layer')).not.toContain('transform');
  });

  // The gate this test replaces was named "degrades to the opacity pulse, not
  // to nothing at all" and asserted ONLY that `getAnimations()` reported an
  // opacity animation on `.askl-overlay-base`. That element never had a
  // background of any kind — the base colour lives on `.askl-overlay` itself —
  // so the assertion was true while the screen showed a completely static
  // block. The test name asserted the opposite of what the screen showed, and
  // it would have FAILED had the pulse ever worked, because a working pulse
  // does not put an opacity animation on that element at all.
  //
  // An animation OBJECT is not a visible property change. The only thing that
  // can tell the two apart is the painted output, so that is what this asserts.
  // Sampled across a whole period because the pulse is a symmetric triangle
  // wave: two samples a half-period apart are legitimately equal even when it
  // works, so "any two distinct frames in the set" is the honest predicate.
  async function paintsMoreThanOneDistinctFrame(
    page: import('@playwright/test').Page,
    selector: string,
  ): Promise<boolean> {
    const clip = (await page.locator(selector).boundingBox())!;
    const samples: Buffer[] = [];
    for (let i = 0; i < 6; i += 1) {
      samples.push(await page.screenshot({ clip }));
      await page.waitForTimeout(Math.round(PULSE_PERIOD_MS / 6));
    }
    return samples.some((s) => Buffer.compare(s, samples[0]!) !== 0);
  }

  test('the captured-key overlay really REPAINTS under reduce — a pulse, not a static block', async ({
    page,
  }) => {
    await render(page);
    expect(await paintsMoreThanOneDistinctFrame(page, '#captured')).toBe(true);
  });

  test('the ADR-12 neutral block degrades identically (same class of bug, sibling instance)', async ({
    page,
  }) => {
    await render(page);
    expect(await animatedProps(page, '#neutral .askl-shimmer-layer')).not.toContain('transform');
    expect(await paintsMoreThanOneDistinctFrame(page, '#neutral')).toBe(true);
  });

  test('a RUNTIME overlay on the same page is untouched — the JS path stays authoritative', async ({
    page,
  }) => {
    await render(page);
    expect(await animatedProps(page, '#runtime .askl-shimmer-layer')).toContain('transform');
  });
});

test.describe('SSR pre-hydration reduced motion — no-preference is unaffected', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('without the preference the captured-key overlay still runs the transform sweep', async ({
    page,
  }) => {
    await render(page);
    expect(await animatedProps(page, '#captured .askl-shimmer-layer')).toContain('transform');
  });

  test('without the preference the neutral block still runs the transform sweep', async ({ page }) => {
    await render(page);
    expect(await animatedProps(page, '#neutral .askl-shimmer-layer')).toContain('transform');
  });
});
