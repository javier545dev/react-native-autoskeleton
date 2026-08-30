// test/web/ssr-drift.spec.ts
//
// The load-bearing claim of the manifest<->CSS binding, proven where it
// actually has to hold: in a real browser's cascade, not in a string
// assertion. A unit test can show the generated selector CONTAINS a token; it
// cannot show that a mismatched pair therefore fails to paint. Only a real
// CSS engine can, and "fails to paint the wrong thing" is the entire point.
//
// Both directions are asserted in the same file on purpose:
//
//   * MATCHED manifest + CSS -> the real captured geometry paints, so the
//     binding did not break the normal path;
//   * DRIFTED manifest + CSS -> the geometry rule does not select and the
//     drift fallback paints the ADR-12 neutral block's dimensions instead.
//
// Before the binding, the drifted case painted the STALE geometry: the rule
// was qualified only by key + direction, both of which survive a
// regeneration, so a `bundle.css` from any other capture run matched happily.
// That is the "subtly wrong geometry ships" failure this exists to make
// structurally impossible.

import { expect, test } from '@playwright/test';
import { buildSsrCssBundle } from '../../cli/media-bundle';
import { computeSsrManifestIntegrity, SSR_BUILD_ATTRIBUTE } from '../../src/web/ssr/integrity';
import type { AutoSkeletonSSRManifest } from '../../src/web/ssr/manifest';
import { SSR_MANIFEST_VERSION } from '../../src/web/ssr/manifest';
import { NEUTRAL_SKELETON_HEIGHT_PX } from '../../src/web/ssr/neutral-geometry';

// The overlay markup is built here rather than by importing
// `AutoSkeletonSSR.tsx`: `@playwright/test` applies its OWN JSX transform to
// any `.tsx` a spec imports (producing its component-testing `__pw_type`
// elements, which `renderToStaticMarkup` then rejects), so a Playwright spec
// cannot render this library's components directly. The chain is covered in
// two proven halves instead of one unprovable one:
//   * that `<AutoSkeleton.SSR>` stamps exactly these attributes, with
//     `manifest.integrity` as the token -> `src/web/ssr/AutoSkeletonSSR.test.ts`;
//   * that the served markup's token and the served CSS's token are the same
//     string end to end -> `test/ssr/dashboard.spec.ts`;
//   * that the CASCADE then does the right thing with a matching and a
//     mismatching token -> this file, which is the only part a real engine
//     can answer.
function overlayMarkup(manifest: AutoSkeletonSSRManifest): string {
  return (
    `<div aria-busy="true" role="status" data-askl-ssr-key="dashboard" data-askl-ssr-dir="ltr" ` +
    `${SSR_BUILD_ATTRIBUTE}="${manifest.integrity}" class="askl-overlay askl-anim-shimmer" ` +
    `style="position:relative;overflow:hidden">` +
    `<div class="askl-shimmer-layer"></div></div>`
  );
}

const CAPTURED_WIDTH = 375;
const CAPTURED_HEIGHT = 312;

function manifestFor(frameHeight: number): AutoSkeletonSSRManifest {
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
          frame: [CAPTURED_WIDTH, frameHeight],
          data: [1, 24, 24, 220, 32, 4],
        },
      },
    ],
  };
  return { ...base, integrity: computeSsrManifestIntegrity(base) };
}

/** Serves the CSS generated from `cssManifest` alongside the markup
 *  `<AutoSkeleton.SSR>` renders for `markupManifest`. Passing two DIFFERENT
 *  manifests is exactly the drift scenario: two files from two capture runs,
 *  committed together. */
async function render(
  page: import('@playwright/test').Page,
  cssManifest: AutoSkeletonSSRManifest,
  markupManifest: AutoSkeletonSSRManifest,
): Promise<void> {
  const css = buildSsrCssBundle(cssManifest, { defaultRadius: 4 });
  const markup = overlayMarkup(markupManifest);
  await page.setViewportSize({ width: CAPTURED_WIDTH, height: 800 });
  await page.setContent(
    `<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${markup}</body></html>`,
    { waitUntil: 'load' },
  );
}

async function overlayGeometry(
  page: import('@playwright/test').Page,
): Promise<{ height: number; clipPath: string }> {
  return page.evaluate(() => {
    const el = document.querySelector('.askl-overlay[data-askl-ssr-key]')!;
    const style = getComputedStyle(el);
    return { height: el.getBoundingClientRect().height, clipPath: style.clipPath };
  });
}

test.describe('SSR manifest <-> CSS binding, evaluated by a real cascade', () => {
  test('a MATCHED manifest and CSS bundle paint the real captured geometry', async ({ page }) => {
    const manifest = manifestFor(CAPTURED_HEIGHT);
    await render(page, manifest, manifest);

    const { height, clipPath } = await overlayGeometry(page);
    expect(height).toBe(CAPTURED_HEIGHT);
    expect(clipPath).toContain('path(');
  });

  test('a DRIFTED pair paints the neutral block, never the stale geometry', async ({ page }) => {
    // Same skeletonKey, same direction, same bucket — everything the OLD
    // selector matched on is unchanged. Only the captured geometry differs,
    // which is precisely what a regeneration of one file and not the other
    // produces.
    const cssManifest = manifestFor(CAPTURED_HEIGHT);
    const staleMarkupManifest = manifestFor(CAPTURED_HEIGHT + 40);
    expect(staleMarkupManifest.integrity).not.toBe(cssManifest.integrity);

    await render(page, cssManifest, staleMarkupManifest);

    const { height, clipPath } = await overlayGeometry(page);
    expect(height).toBe(NEUTRAL_SKELETON_HEIGHT_PX);
    expect(height).not.toBe(CAPTURED_HEIGHT);
    expect(clipPath).toBe('none');
  });

  test('the CSS publishes its own token, so a dev build can name which artifact is stale', async ({
    page,
  }) => {
    const cssManifest = manifestFor(CAPTURED_HEIGHT);
    await render(page, cssManifest, manifestFor(CAPTURED_HEIGHT + 40));

    const cssToken = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--askl-ssr-build').trim(),
    );
    expect(cssToken.replace(/^["']|["']$/g, '')).toBe(cssManifest.integrity);
  });
});
