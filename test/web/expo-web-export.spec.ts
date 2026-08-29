// test/web/expo-web-export.spec.ts
//
// tasks.md G.17 — the Expo Web integration gate.
//
// `test/web/react-native-web.spec.ts` proves the DOM sensor is correct
// against react-native-web's DOM output, but it does so by bundling `src/`
// with esbuild. That says nothing about whether a real consumer's Expo
// toolchain RESOLVES this package to the web entry at all, or whether the
// example app actually runs on web. This spec closes that gap end to end:
// it packs the library exactly as `npm publish` would, materializes those
// bytes into `examples/expo/node_modules`, runs a real
// `expo export --platform web`, serves the resulting static site, and drives
// it in a real browser.
//
// Two independent halves, deliberately not conflated:
//   RESOLUTION — proven from the exported bundle as TEXT, before a browser is
//   involved. `@expo/metro-config` scopes the `react-native` condition to
//   ios/android/tvos/macos and gives web only `['browser']`, so the web
//   condition MUST be listed before `react-native` in `exports['.']` or Metro
//   picks up `index.native.js` and the build fails on
//   `codegenNativeComponent`. That failure mode is real and was observed
//   during this task (see `examples/expo/App.web.tsx`'s header).
//   PAINT — proven by probing Chromium's own `clip-path` hit region, so a
//   skeleton built from the WRONG rects fails even though it would still look
//   like a plausible skeleton in a screenshot.

import { expect, test } from '@playwright/test';
import { buildExpoWebExport, serveStatic, type ExpoWebBuild, type StaticServer } from './helpers/expo-web-app';

let build: ExpoWebBuild;
let server: StaticServer;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, testInfo) => {
  // `npm pack` re-runs `bob build` via the `prepare` lifecycle script and the
  // Metro export bundles ~400 modules; both are slow relative to the rest of
  // this suite, matching the budget `test/ssr/dashboard.spec.ts` already
  // takes for `next build`.
  testInfo.setTimeout(600_000);
  build = buildExpoWebExport();
  server = await serveStatic(build.outDir);
});

test.afterAll(async () => {
  await server?.stop();
});

test.describe('Expo Web export — resolution (proven from the exported bundle text)', () => {
  test('Metro resolved autoskeleton to the WEB entry: the CSS overlay renderer is present and no native codegen specifier is', async () => {
    // Fingerprints of `src/index.web.ts`'s transitive graph. Both are string
    // literals that only exist in `src/web/css-renderer.ts`.
    expect(build.bundleSource).toContain('askl-overlay');
    expect(build.bundleSource).toContain('autoskeleton-css-renderer-styles');

    // Fingerprints of `src/index.native.ts`'s transitive graph. If the
    // `react-native` condition had won on web, Metro would either have
    // inlined these or (more likely) refused to bundle at all.
    expect(build.bundleSource).not.toContain('codegenNativeComponent');
    expect(build.bundleSource).not.toContain('AutoskeletonOverlayNativeComponent');
    expect(build.bundleSource).not.toContain('AUTOSKELETON_NATIVE_MODULE_UNAVAILABLE_DOCS_URL');
  });

  test('the exported site is a complete static artifact: one HTML entry that references the one bundle', async () => {
    const response = await fetch(`${server.baseURL}/index.html`);
    expect(response.status).toBe(200);
    const html = await response.text();
    const bundleName = build.bundlePath.split('/').pop()!;
    expect(html).toContain(bundleName);
  });
});

test.describe('Expo Web export — paint (proven by Chromium hit-testing the real clip-path)', () => {
  test('the skeleton covers the avatar and every glyph run, and covers NEITHER the leading gaps NOR the empty tail of a short line', async ({
    page,
  }) => {
    await page.goto(server.baseURL, { waitUntil: 'load' });
    await page.waitForSelector('.askl-overlay', { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    // One repaint after fonts settle, so the measured rects are the painted
    // ones rather than a pre-font-swap layout.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

    const probes = await page.evaluate(() => {
      const overlays = document.querySelectorAll('.askl-overlay');
      if (overlays.length !== 1) {
        throw new Error(`expected exactly one .askl-overlay, found ${overlays.length}`);
      }
      const overlay = overlays[0] as HTMLElement;
      // `.askl-overlay` ships `pointer-events: none`; re-enabling it for the
      // probe turns `elementFromPoint` into a read of the browser's own
      // rasterized clip region (Chromium applies `clip-path` to hit testing),
      // which is a stronger claim than re-deriving rects from the path text.
      overlay.style.pointerEvents = 'auto';
      const covered = (x: number, y: number): boolean => {
        const hit = document.elementFromPoint(x, y);
        return hit === overlay || overlay.contains(hit);
      };
      const box = (id: string): DOMRect =>
        (document.querySelector(`[data-testid="${id}"]`) as HTMLElement).getBoundingClientRect();
      const glyphsOf = (id: string): DOMRect => {
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = Array.from(range.getClientRects()).filter(
          (r) => r.width > 0.5 && r.height > 0.5,
        );
        if (rects.length === 0) {
          throw new Error(`no glyph rects for ${id}`);
        }
        return rects[0]!;
      };

      const avatar = box('avatar');
      const title = box('title');
      const titleGlyphs = glyphsOf('title');
      const subtitleGlyphs = glyphsOf('subtitle');
      const bodyGlyphs = glyphsOf('body');
      const card = box('card');

      return {
        clipPath: getComputedStyle(overlay).clipPath,
        overlayWidth: overlay.getBoundingClientRect().width,
        overlayHeight: overlay.getBoundingClientRect().height,
        cardWidth: card.width,
        cardHeight: card.height,
        titleLeading: title.height - titleGlyphs.height,
        titleTail: title.width - titleGlyphs.width,

        avatarCentre: covered(avatar.left + 32, avatar.top + 32),
        avatarCorner: covered(avatar.left + 2, avatar.top + 2),
        titleGlyphs: covered(titleGlyphs.left + titleGlyphs.width / 2, titleGlyphs.top + titleGlyphs.height / 2),
        subtitleGlyphs: covered(
          subtitleGlyphs.left + subtitleGlyphs.width / 2,
          subtitleGlyphs.top + subtitleGlyphs.height / 2,
        ),
        bodyGlyphs: covered(bodyGlyphs.left + bodyGlyphs.width / 2, bodyGlyphs.top + bodyGlyphs.height / 2),
        aboveTitleGlyphs: covered(titleGlyphs.left + titleGlyphs.width / 2, title.top + 2),
        belowTitleGlyphs: covered(titleGlyphs.left + titleGlyphs.width / 2, title.bottom - 2),
        titleEmptyTail: covered(title.right - 4, titleGlyphs.top + titleGlyphs.height / 2),
        outsideCard: covered(card.right + 40, card.top + 20),
      };
    });

    expect(probes.clipPath).toContain('path(');
    // The overlay is sized to the measured subtree, not the viewport.
    expect(Math.abs(probes.overlayWidth - probes.cardWidth)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(probes.overlayHeight - probes.cardHeight)).toBeLessThanOrEqual(0.5);

    // Anti-vacuity: the "must NOT be covered" probes only mean something if
    // the gaps they aim at genuinely exist in this render.
    expect(probes.titleLeading, 'the 40px lineHeight must leave real empty leading').toBeGreaterThan(10);
    expect(probes.titleTail, 'the title must be narrower than its line box').toBeGreaterThan(40);

    expect(probes.avatarCentre, 'avatar centre covered').toBe(true);
    expect(probes.titleGlyphs, 'title glyph run covered').toBe(true);
    expect(probes.subtitleGlyphs, 'subtitle glyph run covered').toBe(true);
    expect(probes.bodyGlyphs, 'body glyph run covered').toBe(true);

    expect(probes.avatarCorner, 'the avatar corner lies outside its 32px radius').toBe(false);
    expect(probes.aboveTitleGlyphs, 'leading above the title stays uncovered').toBe(false);
    expect(probes.belowTitleGlyphs, 'leading below the title stays uncovered').toBe(false);
    expect(probes.titleEmptyTail, 'the empty tail of the title stays uncovered').toBe(false);
    expect(probes.outsideCard, 'nothing outside the card is covered').toBe(false);
  });

  test('the skeleton is a live loading state, not a painted picture: it hands off to real content, and a second load keeps that content visible per the REQ-PTR-1 stale-while-revalidate default', async ({
    page,
  }) => {
    await page.goto(server.baseURL, { waitUntil: 'load' });
    await page.waitForSelector('.askl-overlay', { timeout: 30_000 });
    expect(await page.locator('.askl-overlay').count()).toBe(1);

    await page.click('[data-testid="toggle"]');
    await expect(page.locator('.askl-overlay')).toHaveCount(0, { timeout: 10_000 });

    // REQ-A11Y-1 (G.16): with the skeleton gone the content must be readable
    // again, not left behind an `aria-hidden` subtree.
    const readable = async (): Promise<boolean> =>
      page.evaluate(
        () => document.querySelector('[data-testid="title"]')!.closest('[aria-hidden="true"]') === null,
      );
    expect(await readable()).toBe(true);
    await expect(page.locator('[data-testid="title"]')).toHaveText('Ada Lovelace');

    // Loading a SECOND time. REQ-PTR-1's default is stale-while-revalidate:
    // once real content has been shown, a later `isLoading=true` must NOT
    // cover it again (`skeletonOnRefresh` is the documented opt-out). This
    // assertion pins the DOCUMENTED behavior rather than the intuitive one —
    // the first draft of this test expected the skeleton back, and the
    // exported app correctly refused.
    await page.click('[data-testid="toggle"]');
    await expect(page.locator('[data-testid="toggle"]')).toHaveText('Stop loading');
    await expect(page.locator('.askl-overlay')).toHaveCount(0, { timeout: 5_000 });
    expect(await readable(), 'stale content stays readable during a refresh').toBe(true);

    // ...but the refresh IS announced, which is the half a suppressed
    // skeleton must not silently drop (G.16).
    const busy = await page.evaluate(
      () => document.querySelector('[data-testid="card"]')!.closest('[aria-busy="true"]') !== null,
    );
    expect(busy, 'a suppressed refresh still announces aria-busy').toBe(true);
  });
});
