// test/web/tailwind-app-theme.spec.ts
//
// tasks.md 7.1 (spec REQ-THEME-1) — the APP-LEVEL complement to
// `test/web/theme-cascade.spec.ts`. That file gates the Tailwind v4 COMPILER
// contract (real `@tailwindcss/cli`, synthetic harness page, computed style).
// This file gates the same contract inside a REAL consuming app
// (`examples/vite`), against that app's OWN production `vite build` output,
// and asserts on PAINTED PIXELS rather than computed style.
//
// ── How this gate separates "the theme was applied" from "the shimmer
//    happened to be at a light phase" ────────────────────────────────────────
//
// The shimmer varies the painted colour along exactly the axis this gate
// asserts on, so a single-frame colour sample is worthless: at some phase the
// pixel is the base colour, at another it is the highlight colour, and at
// every phase in between it is a blend. A gate that accepts "the pixel is
// somewhere plausible" is satisfiable by accident.
//
// This gate therefore never samples a free-running animation. It PINS the
// phase: `document.getAnimations()` is used to pause the `askl-shimmer`
// animation and seek it to an exact iteration progress, so every sample is
// taken at a phase this test chose, not one the clock happened to be at. It
// then walks the WHOLE cycle (p = 0.00 … 1.00) and asserts the entire
// observed curve:
//
//   * p = 0 and p = 1 must be EXACTLY the themed base colour. At those phases
//     the gradient's transparent edge is over the sample point, so nothing but
//     `--skl-base` is painted there.
//   * p = 0.5 must be EXACTLY the themed highlight colour. At that phase the
//     gradient's opaque peak is over the sample point, so `--skl-highlight` is
//     painted at full alpha.
//   * every sample must lie ON the segment between those two colours
//     (perpendicular residual in RGB space below RESIDUAL_TOLERANCE), and its
//     position along that segment must follow the triangle wave the sweep
//     geometry dictates: t(p) = 1 - |2p - 1|.
//
// Both ramp ENDPOINTS are pinned, so a wrong theme cannot satisfy this at any
// phase: the library's own defaults (#e2e2e2/#f5f5f5) are not on the themed
// segment at all, and a shimmer sitting at a light phase produces a sample
// whose `t` is wrong for the phase it was seeked to. "Somewhere on a colour
// ramp" is exactly the assertion shape that let a real iOS defect through
// earlier in this project; it is deliberately not the assertion shape here.
//
// The gate is also RED-proven the honest way: the demo section existed in
// `examples/vite` BEFORE Tailwind was installed there, and this file failed
// with `rgb(226, 226, 226)` / `rgb(245, 245, 245)` — the library's hardcoded
// JS defaults — at every phase. See the apply report for the exact output.

import { expect, test, type Page } from '@playwright/test';
import { buildViteApp, previewViteApp, readBuiltCss, type RunningServer } from './helpers/vite-app';

const PREVIEW_PORT = 4201;

// The exact values `examples/vite/src/tailwind-theme.css` declares inside its
// Tailwind v4 `@theme` block. Literal hexes deliberately: Tailwind v4's own
// palette (`--color-blue-800` etc.) is authored in `oklch()`, whose sRGB
// round-trip is not byte-stable across Chromium versions, and this gate must
// fail for theming reasons only — never for colour-space drift.
const LIGHT_BASE = [30, 64, 175] as const; // #1e40af
const LIGHT_HIGHLIGHT = [245, 158, 11] as const; // #f59e0b
const DARK_BASE = [6, 95, 70] as const; // #065f46
const DARK_HIGHLIGHT = [167, 243, 208] as const; // #a7f3d0

// `src/web/css-renderer.ts` DEFAULT_BASE_COLOR / DEFAULT_HIGHLIGHT_COLOR.
const LIBRARY_DEFAULT_BASE = [226, 226, 226] as const;
const LIBRARY_DEFAULT_HIGHLIGHT = [245, 245, 245] as const;

type Rgb = readonly [number, number, number];

/** Per-channel tolerance for an endpoint sample. Endpoints are pure fills
 *  (alpha 0 or alpha 1 over a flat colour), so this is tight on purpose. */
const ENDPOINT_TOLERANCE = 2;
/** How far a mid-sweep sample may sit OFF the base->highlight segment in RGB
 *  space. This is the assertion the shimmer cannot buy its way past: being on
 *  the right ramp is a property of the theme, not of the phase. */
const RESIDUAL_TOLERANCE = 4;
/** How far the measured position along the ramp may drift from the position
 *  the sweep geometry predicts for the pinned phase. */
const PROGRESS_TOLERANCE = 0.06;

let server: RunningServer;

test.describe.configure({ mode: 'serial' });

test.use({
  // The shimmer must actually run for this suite: under the repo-wide default
  // (`reducedMotion: 'reduce'`, playwright.config.ts) `AutoSkeleton` degrades
  // shimmer to pulse and the highlight layer is `opacity: 0` — there would be
  // no highlight endpoint to pin.
  contextOptions: { reducedMotion: 'no-preference' },
  // `examples/vite`'s own stylesheet has a `prefers-color-scheme: dark` block.
  // Pin it so the ONLY thing that changes the page's colours in the dark-mode
  // test is the `.dark` class the app's button toggles.
  colorScheme: 'light',
});

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  await buildViteApp();
  server = await previewViteApp(PREVIEW_PORT);
});

test.afterAll(async () => {
  await server?.stop();
});

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function maxChannelDelta(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** Decomposes an observed colour against a base->highlight ramp: `t` is how
 *  far along the ramp it sits, `residual` is how far OFF the ramp it is. */
function decomposeOnRamp(observed: Rgb, base: Rgb, highlight: Rgb): { t: number; residual: number } {
  const d: Rgb = [highlight[0] - base[0], highlight[1] - base[1], highlight[2] - base[2]];
  const v: Rgb = [observed[0] - base[0], observed[1] - base[1], observed[2] - base[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dd;
  const projected: Rgb = [base[0] + t * d[0], base[1] + t * d[1], base[2] + t * d[2]];
  return { t, residual: distance(observed, projected) };
}

/** Pauses the shimmer and seeks it to iteration progress `p`, so the sample
 *  taken next is at a phase this test chose. Returns the progress the browser
 *  actually reports, which is asserted — a seek that silently did nothing
 *  would otherwise turn this whole suite back into single-frame sampling. */
async function pinShimmerPhase(page: Page, p: number): Promise<number[]> {
  const progresses = await page.evaluate((progress) => {
    const observed: number[] = [];
    for (const animation of document.getAnimations()) {
      if ((animation as CSSAnimation).animationName !== 'askl-shimmer') {
        continue;
      }
      animation.pause();
      const timing = animation.effect!.getComputedTiming();
      const duration = Number(timing.duration);
      // `css-renderer.ts` gives every instance a NEGATIVE `animation-delay` so
      // all mounted skeletons share one clock phase, so the naive seek
      // (`currentTime = delay + p * duration`) lands on a negative
      // `currentTime` for small `p`. Measured: Chromium then reports
      // `getComputedTiming().progress === null` and, with the CSS default
      // `animation-fill-mode: none`, applies NOTHING — the shimmer layer would
      // render untransformed, which is a different frame from progress 0
      // rather than the same one. Adding whole periods (the animation is
      // `iteration-count: infinite`, so iteration k is identical to iteration
      // 0) moves the seek into positive time WITHOUT touching the animation's
      // own timing.
      const delay = Number(timing.delay ?? 0);
      // Progress exactly 1 is the first frame of the NEXT iteration and is not
      // representable; 1 - 1e-3 of a 1400 ms period is 1.4 ms short of it,
      // i.e. 0.07% of the sweep — far below every tolerance below.
      const clamped = Math.min(progress, 1 - 1e-3);
      let time = delay + clamped * duration;
      while (time < duration) {
        time += duration;
      }
      animation.currentTime = time;
      observed.push(Number(animation.effect!.getComputedTiming().progress ?? -1));
    }
    return observed;
  }, p);
  // Let the compositor draw the seeked frame before anything screenshots it.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  return progresses;
}

/** Reads back one PAINTED pixel: a real Chromium screenshot of the live page,
 *  decoded in-page through `createImageBitmap` + `OffscreenCanvas` (no DOM
 *  mutation, no PNG-decoding dependency). Computed style is deliberately NOT
 *  used — it would report the value the renderer asked for, not the value the
 *  compositor actually put on screen. */
async function paintedPixel(page: Page, x: number, y: number): Promise<Rgb> {
  const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2]] as [number, number, number];
  }, shot.toString('base64'));
}

/** The centre of the themed card's skeleton overlay — the point the sweep's
 *  opaque peak crosses at exactly p = 0.5 and whose gradient contribution is
 *  exactly zero at p = 0 and p = 1 (the layer is 200% wide, translating
 *  -50% -> +50%, so the peak travels from -50% to +150% of the overlay). */
async function overlayCentre(page: Page): Promise<{ x: number; y: number }> {
  const overlay = page.locator('[data-testid="themed-demo"] .askl-overlay');
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

async function openThemedDemo(page: Page): Promise<{ x: number; y: number }> {
  await page.goto(`${server.baseURL}/`);
  await page.locator('[data-testid="themed-card"]').scrollIntoViewIfNeeded();
  return overlayCentre(page);
}

test.describe('Tailwind v4 theming in a real consumer app (REQ-THEME-1, tasks.md 7.1)', () => {
  test("the app's production build ships the @theme tokens the skeleton resolves through", async () => {
    // Whitespace-tolerant: the production build runs the emitted CSS through
    // Vite's minifier, so `--color-skl-base: #1e40af` ships as
    // `--color-skl-base:#1e40af`.
    const css = readBuiltCss();
    // The token really survived Tailwind v4's `@theme` handling into the
    // emitted stylesheet...
    expect(css).toMatch(/--color-skl-base:\s*#1e40af/);
    expect(css).toMatch(/--color-skl-highlight:\s*#f59e0b/);
    // ...and is really aliased onto the library's own contract names.
    expect(css).toMatch(/--skl-base:\s*var\(--color-skl-base\)/);
    // Scoped to the demo's own container rather than `:root` (2026-08-29): the
    // showcase renders eleven demos on one page, and a document-root alias
    // inherited into all of them. The substance asserted here is unchanged —
    // that the dark alias survives compilation onto the library's contract
    // name — only the selector it lives under moved.
    expect(css).toMatch(/\.dark\s+\[data-testid=?['"]?themed-demo['"]?\]\s*\{[^}]*--skl-base:\s*var\(--color-skl-base-dark\)/);
    // A utility class only the real Tailwind compiler could have produced from
    // scanning this app's TSX — proof the whole pipeline ran, not just that a
    // `:root` block was hand-written somewhere.
    expect(css).toMatch(/\.rounded-xl\s*\{/);
  });

  test('every painted phase of the shimmer resolves from the @theme tokens, endpoints included', async ({ page }) => {
    const centre = await openThemedDemo(page);

    const phases = [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1];
    const samples: { p: number; rgb: Rgb }[] = [];
    for (const p of phases) {
      const reported = await pinShimmerPhase(page, p);
      // Exactly one shimmer animation on the themed card, and the seek took.
      expect(reported.length).toBeGreaterThanOrEqual(1);
      for (const actual of reported) {
        expect(Math.abs(actual - p), `shimmer seek to phase ${p} reported ${actual}`).toBeLessThan(0.01);
      }
      samples.push({ p, rgb: await paintedPixel(page, centre.x, centre.y) });
    }

    const at = (p: number): Rgb => samples.find((s) => s.p === p)!.rgb;

    // ── Endpoint 1: the base colour, painted alone. ──
    expect(maxChannelDelta(at(0), LIGHT_BASE)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
    expect(maxChannelDelta(at(1), LIGHT_BASE)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
    // ── Endpoint 2: the highlight colour, painted at full alpha. ──
    expect(maxChannelDelta(at(0.5), LIGHT_HIGHLIGHT)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);

    // Neither endpoint is the library's own JS default at any phase — stated
    // separately so a failure says WHICH thing went wrong.
    for (const { p, rgb } of samples) {
      expect(
        distance(rgb, LIBRARY_DEFAULT_BASE),
        `phase ${p} painted the library default base colour`,
      ).toBeGreaterThan(20);
      expect(
        distance(rgb, LIBRARY_DEFAULT_HIGHLIGHT),
        `phase ${p} painted the library default highlight colour`,
      ).toBeGreaterThan(20);
    }

    // ── The whole curve, not just its endpoints. ──
    for (const { p, rgb } of samples) {
      const { t, residual } = decomposeOnRamp(rgb, LIGHT_BASE, LIGHT_HIGHLIGHT);
      expect(residual, `phase ${p} painted rgb(${rgb.join(', ')}), which is off the themed ramp`).toBeLessThanOrEqual(
        RESIDUAL_TOLERANCE,
      );
      const expectedT = 1 - Math.abs(2 * p - 1);
      expect(
        Math.abs(t - expectedT),
        `phase ${p} sits at ${t.toFixed(3)} along the ramp; the sweep geometry predicts ${expectedT.toFixed(3)}`,
      ).toBeLessThanOrEqual(PROGRESS_TOLERANCE);
    }
  });

  test('the app\'s own dark-mode toggle moves BOTH ramp endpoints via cascade alone', async ({ page }) => {
    const centre = await openThemedDemo(page);

    await pinShimmerPhase(page, 0);
    const lightBase = await paintedPixel(page, centre.x, centre.y);
    await pinShimmerPhase(page, 0.5);
    const lightHighlight = await paintedPixel(page, centre.x, centre.y);
    expect(maxChannelDelta(lightBase, LIGHT_BASE)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
    expect(maxChannelDelta(lightHighlight, LIGHT_HIGHLIGHT)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);

    // The ONLY action: the app's own button, which does nothing but
    // `document.documentElement.classList.toggle('dark')`. No skeleton prop
    // changes, no `SkeletonProvider`, no renderer call, no remount.
    await page.locator('[data-testid="toggle-theme"]').click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Re-derive the sample point: Playwright scrolls a target into view before
    // clicking it, so the cached viewport coordinate can no longer be trusted
    // to be the card's centre. (Sampling the stale coordinate is what made the
    // first run of this test report an off-card pixel.)
    const darkCentre = await overlayCentre(page);
    await pinShimmerPhase(page, 0);
    const darkBase = await paintedPixel(page, darkCentre.x, darkCentre.y);
    await pinShimmerPhase(page, 0.5);
    const darkHighlight = await paintedPixel(page, darkCentre.x, darkCentre.y);

    expect(maxChannelDelta(darkBase, DARK_BASE)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
    expect(maxChannelDelta(darkHighlight, DARK_HIGHLIGHT)).toBeLessThanOrEqual(ENDPOINT_TOLERANCE);
    // Both endpoints MOVED — a dark-mode rule that only re-declared one of the
    // two would otherwise pass half of this silently.
    expect(distance(darkBase, lightBase)).toBeGreaterThan(20);
    expect(distance(darkHighlight, lightHighlight)).toBeGreaterThan(20);
  });
});
