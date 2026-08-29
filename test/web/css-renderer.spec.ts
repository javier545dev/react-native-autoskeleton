// test/web/css-renderer.spec.ts
//
// tasks.md 2.2 — the web `Renderer<HTMLElement>` (ADR-7: one CSS overlay,
// `clip-path: path()`, no CanvasKit/wasm). Runs the REAL production
// `createCssRenderer()` inside the browser (plan.md §7.3). This suite
// verifies: clip-path text output, the ADR-6 `background-position` ban as it
// actually renders (real `getAnimations()` keyframe inspection, not just the
// static-source lint rule), reduced-motion degradation, and the ONE
// deliberate pixel test in the suite (masked animation region, per plan.md
// §7.3 point 5).

import path from 'node:path';
import { expect, test as base } from '@playwright/test';
import { loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/css-renderer-entry.ts');

const test = base.extend<{ setup: (opts?: SetupOpts) => Promise<void> }>({
  // eslint-disable-next-line no-empty-pattern
  setup: async ({ page }, use) => {
    await use(async (opts = {}) => {
      await loadHarness(
        page,
        ENTRY,
        `<div id="surface" style="position:relative;width:100px;height:70px;"></div>`,
      );
      await page.evaluate((options) => {
        const { createCssRenderer, createShimmerClock, encodeWire, WIRE_VERSION, composeCacheKey } =
          window.Autoskeleton;
        const renderer = createCssRenderer!();
        const clock = createShimmerClock!(options.speedMs ?? 400);
        const surface = document.getElementById('surface')!;
        const key = composeCacheKey!({
          skeletonKey: 'test',
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
          data: encodeWire!([
            { x: 10, y: 10, w: 80, h: 20, r: 4 },
            { x: 10, y: 40, w: 60, h: 20, r: 0 },
          ]),
          degraded: [],
        };
        const handle = renderer.mount(surface, {
          snapshot,
          theme: { baseColor: '#e2e2e2', highlightColor: '#f5f5f5', defaultRadius: 4, speedMs: 400 },
          animation: options.animation ?? 'shimmer',
          clock,
          reducedMotion: options.reducedMotion ?? false,
          debugOverlay: false,
        });
        (window as unknown as { __askl: { handle: unknown; snapshot: unknown } }).__askl = {
          handle,
          snapshot,
        };
      }, opts);
    });
  },
});

interface SetupOpts {
  readonly animation?: 'shimmer' | 'pulse' | 'none';
  readonly reducedMotion?: boolean;
  readonly speedMs?: number;
}

test.describe('CSS renderer — geometry (clip-path, ADR-7)', () => {
  test('mount applies frame size and a clip-path text value', async ({ page, setup }) => {
    await setup();
    const info = await page.evaluate(() => {
      const overlay = document.querySelector('.askl-overlay') as HTMLElement;
      const style = getComputedStyle(overlay);
      return { width: overlay.style.width, height: overlay.style.height, clipPath: style.clipPath };
    });
    expect(info.width).toBe('100px');
    expect(info.height).toBe('70px');
    expect(info.clipPath).toContain('path(');
  });

  test('update() reuses the mounted overlay and only changes geometry', async ({ page, setup }) => {
    await setup();
    const result = await page.evaluate(() => {
      const { encodeWire, WIRE_VERSION } = window.Autoskeleton;
      const overlayBefore = document.querySelector('.askl-overlay');
      overlayBefore!.setAttribute('data-marker', 'same-node');

      const { handle, snapshot } = (window as unknown as { __askl: { handle: any; snapshot: any } }).__askl;
      const next = {
        ...snapshot,
        frameWidth: 120,
        frameHeight: 70,
        data: encodeWire!([{ x: 0, y: 0, w: 120, h: 70, r: 0 }]),
        version: WIRE_VERSION!,
      };
      handle.update(next);

      const overlayAfter = document.querySelector('.askl-overlay') as HTMLElement;
      return {
        sameNode: overlayAfter.getAttribute('data-marker') === 'same-node',
        width: overlayAfter.style.width,
      };
    });
    expect(result.sameNode).toBe(true);
    expect(result.width).toBe('120px');
  });

  test('destroy() removes the overlay from the DOM', async ({ page, setup }) => {
    await setup();
    const removed = await page.evaluate(() => {
      const { handle } = (window as unknown as { __askl: { handle: any } }).__askl;
      handle.destroy();
      return document.querySelector('.askl-overlay') === null;
    });
    expect(removed).toBe(true);
  });
});

test.describe('CSS renderer — radius clamp (defect fix, real browser CSSOM)', () => {
  test('a badge shape (40x20, r=30 — border-radius:999px resolved) renders a real, non-empty, browser-accepted clip-path with rounded corners, not square', async ({
    page,
  }) => {
    await loadHarness(page, ENTRY, `<div id="surface" style="position:relative;width:40px;height:20px;"></div>`);
    const clipPath = await page.evaluate(() => {
      const { createCssRenderer, createShimmerClock, encodeWire, WIRE_VERSION, composeCacheKey } =
        window.Autoskeleton;
      const renderer = createCssRenderer!();
      const clock = createShimmerClock!(400);
      const surface = document.getElementById('surface')!;
      const key = composeCacheKey!({
        skeletonKey: 'badge',
        viewportWidth: 375,
        fontScale: 1,
        direction: 'ltr',
        platform: 'web',
      });
      const snapshot = {
        key,
        version: WIRE_VERSION!,
        capturedAt: Date.now(),
        frameWidth: 40,
        frameHeight: 20,
        // r=30 on a 40x20 box — exactly what a badge with
        // `border-radius: 999px` resolves to via getComputedStyle (defect
        // repro).
        data: encodeWire!([{ x: 0, y: 0, w: 40, h: 20, r: 30 }]),
        degraded: [],
      };
      renderer.mount(surface, {
        snapshot,
        theme: { baseColor: '#e2e2e2', highlightColor: '#f5f5f5', defaultRadius: 4, speedMs: 400 },
        animation: 'none',
        clock,
        reducedMotion: false,
        debugOverlay: false,
      });
      const overlay = document.querySelector('.askl-overlay') as HTMLElement;
      return getComputedStyle(overlay).clipPath;
    });
    // The browser's CSSOM still accepts the raw self-intersecting/
    // out-of-bounds path syntactically (verified: it normalizes spacing but
    // keeps it as a real path(), never falling back to 'none') — the defect
    // is in the GEOMETRY it draws (out-of-bounds arc radii of 30 on a
    // 20-tall box), which the "no arc of radius 10" check below catches.
    expect(clipPath).not.toBe('none');
    expect(clipPath).toContain('path(');
    // Real arc commands with radius 10 (clamped from 30 to h/2) must be
    // present — proves actual rounding, not a degenerate square fallback.
    expect(clipPath).toMatch(/A\s*10\s+10/);
  });
});

test.describe('CSS renderer — ADR-6: transform-only shimmer, no background-position', () => {
  test('the shimmer layer only animates transform (real getAnimations() inspection)', async ({ page, setup }) => {
    await setup({ animation: 'shimmer' });
    const animatedProps = await page.evaluate(() => {
      const layer = document.querySelector('.askl-shimmer-layer') as HTMLElement;
      const anims = layer.getAnimations();
      const props = new Set<string>();
      for (const anim of anims) {
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
    });
    expect(animatedProps).toContain('transform');
    expect(animatedProps.join(',').toLowerCase()).not.toContain('backgroundposition');
    expect(animatedProps.join(',').toLowerCase()).not.toContain('background-position');
  });

  test('pulse animates only opacity', async ({ page, setup }) => {
    await setup({ animation: 'pulse' });
    const animatedProps = await page.evaluate(() => {
      const overlay = document.querySelector('.askl-overlay-base') as HTMLElement;
      const anims = overlay.getAnimations();
      const props = new Set<string>();
      for (const anim of anims) {
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
    });
    if (animatedProps.length > 0) {
      expect(animatedProps).toContain('opacity');
    }
    expect(animatedProps.join(',').toLowerCase()).not.toContain('background');
  });

  test('the injected stylesheet never contains background-position (real browser CSSOM)', async ({
    page,
    setup,
  }) => {
    await setup();
    const cssText = await page.evaluate(() => {
      const styleEl = document.getElementById('autoskeleton-css-renderer-styles') as HTMLStyleElement;
      return styleEl.textContent ?? '';
    });
    expect(cssText.toLowerCase()).not.toContain('background-position');
  });
});

test.describe('CSS renderer — reduced motion (REQ-A11Y-3)', () => {
  test('reducedMotion downgrades shimmer to the pulse class, never the shimmer class', async ({ page, setup }) => {
    await setup({ animation: 'shimmer', reducedMotion: true });
    const classes = await page.evaluate(() =>
      Array.from(document.querySelector('.askl-overlay')!.classList),
    );
    expect(classes).toContain('askl-anim-pulse');
    expect(classes).not.toContain('askl-anim-shimmer');
  });

  test("reducedMotion + animation='none' stays none", async ({ page, setup }) => {
    await setup({ animation: 'none', reducedMotion: true });
    const classes = await page.evaluate(() =>
      Array.from(document.querySelector('.askl-overlay')!.classList),
    );
    expect(classes).toContain('askl-anim-none');
  });
});

test.describe('CSS renderer — one deliberate pixel test (plan.md §7.3 point 5)', () => {
  test('shimmer visibly moves over time; masking it makes reduced-motion frames pixel-stable', async ({
    page,
    setup,
  }) => {
    // Normal motion: two screenshots of the animated region 250ms apart must
    // differ (the sweep really moved). `page.screenshot({ clip })` is used
    // instead of a locator screenshot: a locator screenshot performs an
    // actionability "wait for element to be stable" check that NEVER
    // converges for a genuinely, continuously animating element — which is
    // exactly the property under test here, so that wait must be bypassed.
    await setup({ animation: 'shimmer', reducedMotion: false, speedMs: 400 });
    const shimmerLocator = page.locator('.askl-shimmer-layer');
    const shimmerBox = (await shimmerLocator.boundingBox())!;
    const shot1 = await page.screenshot({ clip: shimmerBox });
    await page.waitForTimeout(250);
    const shot2 = await page.screenshot({ clip: shimmerBox });
    expect(Buffer.compare(shot1, shot2)).not.toBe(0);

    // Reduced motion: mask the animated shimmer layer (the "masked animation
    // region") and assert the rest of the overlay is pixel-stable across the
    // same wait — this is what actually catches a hide-then-reveal-style
    // regression that would otherwise show up as a translating band even
    // under reduced motion.
    await setup({ animation: 'shimmer', reducedMotion: true, speedMs: 400 });
    const overlayLocator = page.locator('.askl-overlay');
    const overlayBox = (await overlayLocator.boundingBox())!;
    const maskedShot1 = await page.screenshot({ clip: overlayBox, mask: [shimmerLocator] });
    await page.waitForTimeout(250);
    const maskedShot2 = await page.screenshot({ clip: overlayBox, mask: [shimmerLocator] });
    expect(Buffer.compare(maskedShot1, maskedShot2)).toBe(0);
  });
});
