// test/web/font-scale.spec.ts
//
// `CacheKeyParts.fontScale` is a shared cache-key segment. Native fills it
// from `PixelRatio.getFontScale()` — the OS text-size setting — and
// `src/native/sensor.ts`'s `observe()` is a documented no-op precisely
// BECAUSE that value rotating the composite key is the whole native
// invalidation channel. Web writes the constant `1`.
//
// That asymmetry reads like an unfinished web implementation, so this suite
// exists to pin the measurements showing it is not one: there is no web
// analogue to read, and the neutral constant is the honest value rather than
// a placeholder waiting to be replaced by an invented number.
//
// These tests are CHARACTERISATION, not a red-green cycle: nothing here was
// failing. They exist so a future change that "fixes" the constant by
// fabricating a reading has to delete an explicit, evidenced claim first.

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadHarness } from './helpers/page';

const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="root" style="width:200px">
    <p id="flow" style="margin:0">default-sized text long enough to wrap inside this narrow box</p>
  </div>
 </body></html>`;

interface Reading {
  readonly rootFontSize: string;
  /** Computed size of a `font-size: medium` element — the only candidate
   *  probe for "what does this browser consider its default text size?". */
  readonly mediumProbe: string;
  readonly flowHeight: number;
}

async function read(page: import('@playwright/test').Page): Promise<Reading> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'font-size:medium;position:absolute;visibility:hidden';
    document.body.appendChild(probe);
    const mediumProbe = getComputedStyle(probe).fontSize;
    probe.remove();
    return {
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      mediumProbe,
      flowHeight: document.getElementById('flow')!.getBoundingClientRect().height,
    };
  });
}

test.describe('the web `PixelRatio.getFontScale()` analogue, and why the probe is the right one', () => {
  // ORCHESTRATOR CORRECTION (G.18). The original version of this test called
  // `Page.setFontSizes` with `{ standardFontSize, fixedFontSize }`, which are
  // not the CDP parameter names — the real shape is `{ standard, fixed }`
  // (`playwright-core/types/protocol.d.ts`, `interface FontSizes`). Chromium
  // silently ignored the unknown keys, so the preference was never actually
  // changed and the "nothing is observable" result was an artifact of a call
  // that did nothing. It only surfaced because the wrong keys also failed
  // `tsc`. With the correct call the preference IS observable, and the text it
  // governs genuinely reflows:
  //
  //   default            root 16px   medium probe 16px   flow height  54
  //   standard = 24      root 24px   medium probe 24px   flow height 112
  //   standard = 24 and the page setting `html { font-size: 62.5% }`
  //                      root 15px   medium probe 24px   flow height  34
  //
  // The `font-size: medium` probe is therefore the correct signal and the
  // document root is not: the probe reports the user's preference in BOTH
  // cases, while the root is whatever the page's own CSS made it.
  //
  // CONSEQUENCE, recorded rather than quietly fixed: `fontScale` is a real
  // cache-key dimension on web, and it is hardcoded to 1. A reader whose
  // browser font preference doubles their text height gets the same cache key
  // and therefore a skeleton laid out for somebody else's font size. Reading
  // it costs bytes against a budget with little headroom left, so the fix is
  // the maintainer's call; this test exists so the claim cannot be re-asserted
  // without deleting measured evidence.
  test("the browser's default-font-size preference IS observable, via a `font-size: medium` probe", async ({
    page,
  }) => {
    const client = await page.context().newCDPSession(page);
    await page.setContent(PAGE, { waitUntil: 'load' });
    const before = await read(page);

    await client.send('Page.setFontSizes', { fontSizes: { standard: 24, fixed: 24 } });
    await page.setContent(PAGE, { waitUntil: 'load' });
    const after = await read(page);
    await client.detach();

    // The preference moves the probe, and moves the geometry that a skeleton
    // has to match. Both halves matter: a signal that moved without the layout
    // moving would not be worth reading.
    expect(before.mediumProbe).toBe('16px');
    expect(after.mediumProbe).toBe('24px');
    expect(after.flowHeight).toBeGreaterThan(before.flowHeight * 1.5);
  });

  test('the probe reports the USER preference, not whatever the page did to its own root', async ({
    page,
  }) => {
    // The other half of why the probe is the right signal, and the root is not.
    // A page that restyles its own root — the `html { font-size: 62.5% }` reset
    // is the common one — changes its text size for reasons that have nothing
    // to do with the reader's preference. `medium` correctly ignores that,
    // which is exactly what a cache-key dimension wants: it must move when the
    // READER's setting moves, and stay put when the author's stylesheet moves.
    await page.setContent(PAGE, { waitUntil: 'load' });
    const before = await read(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    const after = await read(page);

    expect(after.rootFontSize).toBe('32px');
    expect(after.flowHeight).toBeGreaterThan(before.flowHeight);
    expect(after.mediumProbe).toBe(before.mediumProbe);
  });

  test('page zoom, the closest thing a web user reaches for, leaves CSS-pixel geometry alone', async ({
    page,
  }) => {
    // Nothing to invalidate: the snapshot is stored in CSS px and the overlay
    // is drawn in CSS px, so both scale together and stay correct.
    await page.setContent(PAGE, { waitUntil: 'load' });
    const before = await read(page);
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    const after = await read(page);
    await client.detach();

    expect(after.flowHeight).toBe(before.flowHeight);
    expect(after.rootFontSize).toBe(before.rootFontSize);
  });
});


const COMPONENT_ENTRY = path.join(__dirname, 'helpers/component-entry.ts');

/** Renders a real `<AutoSkeleton>` and returns the `cacheKey` its own
 *  `onMetrics` reports. The key's shape is
 *  `v1|skeletonKey|itemType|viewportWidth|fontScale|direction|platform`, so
 *  asserting on it proves the reading reached the thing it exists to affect —
 *  cache identity — rather than that a helper returns a number. */
async function renderAndReadCacheKey(page: import('@playwright/test').Page): Promise<string> {
  await loadHarness(page, COMPONENT_ENTRY, `<div id="root"></div>`);
  await page.evaluate(() => {
    const w = window as unknown as { __metrics: unknown[]; __render: (loading: boolean) => void };
    w.__metrics = [];
    const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore, __resetFontScaleForTests } =
      window.AutoskeletonComponent;
    __resetFontScaleForTests();
    const store = new MemoryShapeStore();
    const root = createRoot(document.getElementById('root')!);
    w.__render = (isLoading: boolean) => {
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            {
              isLoading,
              skeletonKey: 'font-scale-screen',
              onMetrics: (m: unknown) => w.__metrics.push(m),
            },
            React.createElement('p', { style: { margin: 0 } }, 'Hello world'),
          ),
        ),
      );
    };
    w.__render(true);
  });
  // `onMetrics` fires on the HANDOFF, once per loading cycle — not on the cold
  // measurement — so the cycle has to actually complete.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.evaluate(() => {
    (window as unknown as { __render: (l: boolean) => void }).__render(false);
  });
  await page.waitForFunction(
    () => (window as unknown as { __metrics: unknown[] }).__metrics.length > 0,
    undefined,
    { timeout: 5000 },
  );
  return page.evaluate(
    () => ((window as unknown as { __metrics: { cacheKey: string }[] }).__metrics[0]?.cacheKey ?? ''),
  );
}

test.describe('the reading reaches the cache key (G.19)', () => {
  test('a default preference composes a key with fontScale 1', async ({ page }) => {
    const key = await renderAndReadCacheKey(page);
    expect(key).toContain('|1|');
  });

  test("a reader's enlarged default font composes a DIFFERENT key", async ({ page }) => {
    // Set the preference BEFORE anything renders: the reading is taken once
    // and cached, which is the whole point of the probe being cheap.
    const client = await page.context().newCDPSession(page);
    await client.send('Page.setFontSizes', { fontSizes: { standard: 24, fixed: 24 } });

    const key = await renderAndReadCacheKey(page);
    await client.detach();

    // 24 / 16 = 1.5, quantized to 2 decimals by the SHARED `quantizeFontScale`
    // that native uses, so both platforms bucket the same way.
    expect(key).toContain('|1.5|');
    expect(key).not.toContain('|1|');
  });
});
